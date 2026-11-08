/**
 * Add or edit a bill. The payer types the items (or scans the receipt with
 * Pro), taps who had what, and the split engine works out everyone's share.
 * ?billId=... edits an existing bill.
 */
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { CurrencyPicker } from '@/components/CurrencyPicker';
import { Icon } from '@/components/Icon';
import { Avatar, Banner, Button, Card, Chip, Field, IconButton, Loading, Row, Screen, SectionTitle, Segmented, Stack, Text } from '@/components/ui';
import { isPro, receiptUrl, saveBill, ScanError, scanReceipt, uploadReceipt, type SaveBillPayload } from '@/lib/api';
import { convertMinor, fetchExchangeRate, formatMoney, minorToInput, parseAmount } from '@/lib/currency';
import { errorMessage } from '@/lib/errors';
import { firstName, isISODate, todayISO } from '@/lib/format';
import { keys, useAccount, useBill } from '@/lib/queries';
import { receiptToDraft } from '@/lib/receipt';
import { computeSplit, convertShares, describeIssue, type SplitResult } from '@/lib/split';
import { useTripData } from '@/lib/trip-hooks';
import type { Member } from '@/lib/types';
import { radius, space, useTheme } from '@/theme';

type DraftItem = { key: string; name: string; priceText: string; assignees: Record<string, number> };

let keySeq = 0;
const newKey = () => `i${Date.now().toString(36)}${(keySeq++).toString(36)}`;
const emptyItem = (): DraftItem => ({ key: newKey(), name: '', priceText: '', assignees: {} });

export default function BillEditor() {
  const { id, billId } = useLocalSearchParams<{ id: string; billId?: string }>();
  const t = useTheme();
  const qc = useQueryClient();
  const { trip, me, members, loading } = useTripData(id);
  const account = useAccount();
  const existing = useBill(billId ?? '');
  const pro = isPro(account.data);
  const base = trip?.base_currency ?? 'USD';

  const [title, setTitle] = useState('');
  const [paidBy, setPaidBy] = useState(me);
  const [date, setDate] = useState(todayISO());
  const [currency, setCurrency] = useState(base);
  const [rateText, setRateText] = useState('1');
  const [rateNote, setRateNote] = useState<string | null>(null);
  const [mode, setMode] = useState<'itemized' | 'equal'>('itemized');
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);
  const [taxText, setTaxText] = useState('');
  const [serviceText, setServiceText] = useState('');
  const [tipText, setTipText] = useState('');
  const [discountText, setDiscountText] = useState('');
  const [equalTotalText, setEqualTotalText] = useState('');
  const [equalPeople, setEqualPeople] = useState<string[] | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [receiptPath, setReceiptPath] = useState<string | null>(null);
  const [source, setSource] = useState<'manual' | 'ai'>('manual');
  const [receiptTotal, setReceiptTotal] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanInfo, setScanInfo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const defaultsRef = useRef(false);

  // Defaults once the trip loads (new bills only).
  useEffect(() => {
    if (trip && !billId && !defaultsRef.current) {
      defaultsRef.current = true;
      setCurrency(trip.base_currency);
      setPaidBy(me);
    }
  }, [trip, billId, me]);

  // Editing: fill the form from the saved bill once.
  useEffect(() => {
    const b = existing.data;
    if (!b || loadedRef.current) return;
    loadedRef.current = true;
    setTitle(b.title);
    setPaidBy(b.paid_by);
    setDate(b.bill_date);
    setCurrency(b.currency);
    setRateText(String(b.fx_rate));
    setMode(b.split_mode);
    setReceiptPath(b.receipt_path);
    setSource(b.source);
    setNotes(b.notes ?? '');
    if (b.split_mode === 'itemized') {
      setItems(
        b.bill_items.map((it) => ({
          key: newKey(),
          name: it.name,
          priceText: minorToInput(it.line_total_minor, b.currency),
          assignees: Object.fromEntries(it.bill_item_shares.map((s) => [s.user_id, s.weight])),
        })),
      );
      setTaxText(b.tax_minor ? minorToInput(b.tax_minor, b.currency) : '');
      setServiceText(b.service_minor ? minorToInput(b.service_minor, b.currency) : '');
      setTipText(b.tip_minor ? minorToInput(b.tip_minor, b.currency) : '');
      setDiscountText(b.discount_minor ? minorToInput(b.discount_minor, b.currency) : '');
    } else {
      setEqualTotalText(minorToInput(b.total_minor, b.currency));
      setEqualPeople(b.bill_shares.map((s) => s.user_id));
    }
    if (b.receipt_path) receiptUrl(b.receipt_path).then((u) => u && setPhotoUri(u));
  }, [existing.data]);

  // Exchange rate when the bill currency differs from the trip currency.
  useEffect(() => {
    if (!trip) return;
    if (currency === base) {
      setRateText('1');
      setRateNote(null);
      return;
    }
    if (billId && existing.data && existing.data.currency === currency) return;
    let cancelled = false;
    setRateNote('Looking up the exchange rate…');
    fetchExchangeRate(currency, base, isISODate(date) ? date : undefined).then((rate) => {
      if (cancelled) return;
      if (rate) {
        setRateText(String(Number(rate.toFixed(6))));
        setRateNote(`European Central Bank rate for ${isISODate(date) ? date : 'today'}. Change it to match what you actually paid.`);
      } else {
        setRateText('');
        setRateNote(`We couldn't find a rate for ${currency}. Enter how many ${base} one ${currency} was.`);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [currency, base, date, trip, billId, existing.data]);

  const everyone = members.map((m) => m.user_id);
  const participants = equalPeople ?? everyone;
  const rate = Number(rateText.replace(',', '.'));
  const rateOk = currency === base || (Number.isFinite(rate) && rate > 0);

  const money = (text: string) => (text.trim() ? parseAmount(text, currency) : 0);

  const split: SplitResult = useMemo(() => {
    if (mode === 'equal') {
      return computeSplit({ mode: 'equal', totalMinor: money(equalTotalText) ?? -1, participants });
    }
    return computeSplit({
      mode: 'itemized',
      items: items
        .filter((it) => it.name.trim() || it.priceText.trim())
        .map((it) => ({
          name: it.name.trim(),
          lineTotalMinor: money(it.priceText) ?? Number.NaN,
          shares: Object.entries(it.assignees)
            .filter(([, w]) => w > 0)
            .map(([userId, weight]) => ({ userId, weight })),
        })),
      taxMinor: money(taxText) ?? 0,
      serviceMinor: money(serviceText) ?? 0,
      tipMinor: money(tipText) ?? 0,
      discountMinor: money(discountText) ?? 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, items, taxText, serviceText, tipText, discountText, equalTotalText, participants.join(','), currency]);

  const totalBase = rateOk ? convertMinor(split.totalMinor, currency, base, currency === base ? 1 : rate) : 0;
  const converted = split.ok && rateOk ? convertShares(split.shares, totalBase) : [];
  const unassignedCount = split.issues.filter((i) => i.kind === 'unassigned-item').length;

  // ---------------------------------------------------------------- items

  const updateItem = (key: string, patch: Partial<DraftItem>) =>
    setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  const toggle = (key: string, userId: string) =>
    setItems((list) =>
      list.map((it) => {
        if (it.key !== key) return it;
        const next = { ...it.assignees };
        if (next[userId]) delete next[userId];
        else next[userId] = 1;
        return { ...it, assignees: next };
      }),
    );
  const bump = (key: string, userId: string) =>
    setItems((list) =>
      list.map((it) =>
        it.key === key ? { ...it, assignees: { ...it.assignees, [userId]: Math.min(9, (it.assignees[userId] ?? 0) + 1) } } : it,
      ),
    );
  const assignAll = (key: string) =>
    updateItem(key, { assignees: Object.fromEntries(everyone.map((u) => [u, 1])) });
  const assignRemainingToEveryone = () =>
    setItems((list) =>
      list.map((it) =>
        Object.values(it.assignees).some((w) => w > 0) ? it : { ...it, assignees: Object.fromEntries(everyone.map((u) => [u, 1])) },
      ),
    );

  // ---------------------------------------------------------------- photo + scan

  const pickPhoto = async (fromCamera: boolean) => {
    setError(null);
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.9 };
    if (fromCamera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return setError('Allow camera access to photograph receipts.');
    }
    const result = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    try {
      const ctx = ImageManipulator.manipulate(asset.uri);
      if ((asset.width ?? 0) > 1600) ctx.resize({ width: 1600 });
      const image = await ctx.renderAsync();
      const saved = await image.saveAsync({ compress: 0.75, format: SaveFormat.JPEG });
      setPhotoUri(saved.uri);
    } catch {
      setPhotoUri(asset.uri);
    }
    setReceiptPath(null);
    setScanInfo(null);
  };

  const ensureUploaded = async (): Promise<string | null> => {
    if (receiptPath) return receiptPath;
    if (!photoUri) return null;
    const path = await uploadReceipt(id, photoUri);
    setReceiptPath(path);
    return path;
  };

  const scan = async () => {
    if (!pro) {
      router.push('/pro');
      return;
    }
    setScanning(true);
    setError(null);
    setScanInfo(null);
    try {
      const path = await ensureUploaded();
      if (!path) return;
      const { receipt, scans_left } = await scanReceipt(path, id, base);
      const draft = receiptToDraft(receipt, currency);
      if (!title.trim() && draft.title) setTitle(draft.title);
      if (draft.date) setDate(draft.date);
      if (draft.currency !== currency) setCurrency(draft.currency);
      if (draft.items.length > 0) {
        setMode('itemized');
        setItems(
          draft.items.map((it) => ({
            key: newKey(),
            name: it.quantity > 1 ? `${it.name} ×${it.quantity}` : it.name,
            priceText: minorToInput(it.lineTotalMinor, draft.currency),
            assignees: {},
          })),
        );
      }
      setTaxText(draft.taxMinor ? minorToInput(draft.taxMinor, draft.currency) : '');
      setServiceText(draft.serviceMinor ? minorToInput(draft.serviceMinor, draft.currency) : '');
      setTipText(draft.tipMinor ? minorToInput(draft.tipMinor, draft.currency) : '');
      setDiscountText(draft.discountMinor ? minorToInput(draft.discountMinor, draft.currency) : '');
      setReceiptTotal(draft.totalMinor);
      setSource('ai');
      setScanInfo(
        `${draft.items.length} items read${draft.notes ? `. Note: ${draft.notes}` : ''}. Now tap who had each item. (${scans_left} scans left this month)`,
      );
    } catch (e) {
      setError(e instanceof ScanError ? e.message : errorMessage(e));
    } finally {
      setScanning(false);
    }
  };

  // ---------------------------------------------------------------- save

  const save = async () => {
    setError(null);
    if (!title.trim()) return setError('Give the bill a name, e.g. "Dinner".');
    if (!isISODate(date)) return setError('The date should look like 2026-11-08.');
    if (!rateOk) return setError(`Enter the exchange rate: how many ${base} one ${currency} was.`);
    if (!split.ok) return setError(split.issues.map(describeIssue).join(' '));
    if (split.totalMinor <= 0) return setError('The bill total is zero.');
    setSaving(true);
    try {
      const path = await ensureUploaded();
      const baseById = new Map(converted.map((c) => [c.userId, c.amountBaseMinor]));
      const payload: SaveBillPayload = {
        id: billId || undefined,
        trip_id: id,
        paid_by: paidBy || me,
        title: title.trim(),
        bill_date: date,
        currency,
        fx_rate: currency === base ? 1 : rate,
        split_mode: mode,
        tax_minor: mode === 'itemized' ? money(taxText) ?? 0 : 0,
        service_minor: mode === 'itemized' ? money(serviceText) ?? 0 : 0,
        tip_minor: mode === 'itemized' ? money(tipText) ?? 0 : 0,
        discount_minor: mode === 'itemized' ? money(discountText) ?? 0 : 0,
        total_minor: split.totalMinor,
        total_base_minor: totalBase,
        receipt_path: path,
        source,
        notes: notes.trim() || null,
        items:
          mode === 'itemized'
            ? items
                .filter((it) => it.name.trim() || it.priceText.trim())
                .map((it) => ({
                  name: it.name.trim() || 'Item',
                  quantity: 1,
                  line_total_minor: money(it.priceText) ?? 0,
                  shares: Object.entries(it.assignees)
                    .filter(([, w]) => w > 0)
                    .map(([user_id, weight]) => ({ user_id, weight })),
                }))
            : [],
        shares: split.shares.map((s) => ({
          user_id: s.userId,
          amount_minor: s.totalMinor,
          amount_base_minor: baseById.get(s.userId) ?? 0,
        })),
      };
      const savedId = await saveBill(payload);
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.bills(id) }),
        qc.invalidateQueries({ queryKey: keys.shares(id) }),
        qc.invalidateQueries({ queryKey: keys.bill(savedId) }),
      ]);
      router.back();
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  };

  if (loading || (billId && existing.isLoading)) return <Loading />;
  if (!trip) return null;

  const nameFor = (m: Member) => (m.user_id === me ? 'Me' : firstName(m.profile.display_name || 'Friend'));
  const mismatch = receiptTotal != null && split.totalMinor > 0 && Math.abs(receiptTotal - split.totalMinor) > 1;

  return (
    <Screen
      footer={
        <Button
          title={billId ? 'Save changes' : `Save bill${split.totalMinor > 0 ? ` · ${formatMoney(split.totalMinor, currency)}` : ''}`}
          onPress={save}
          loading={saving}
          testID="save-bill"
        />
      }>
      {/* Receipt photo + AI scan */}
      <Card>
        {photoUri ? (
          <Row gap={space.md} align="flex-start">
            <Image source={{ uri: photoUri }} style={{ width: 72, height: 96, borderRadius: radius.sm, backgroundColor: t.surfaceAlt }} contentFit="cover" />
            <View style={{ flex: 1, gap: space.sm }}>
              <Text variant="label">Receipt photo added</Text>
              <Button
                title={pro ? 'Read items with AI' : 'Read items with AI · Pro'}
                icon="sparkles"
                small
                loading={scanning}
                onPress={scan}
                testID="scan-receipt"
              />
              <Button title="Change photo" kind="ghost" small onPress={() => pickPhoto(false)} />
            </View>
          </Row>
        ) : (
          <>
            <Text variant="label">Receipt photo (optional)</Text>
            <Row>
              {Platform.OS !== 'web' ? (
                <Button title="Take photo" icon="camera" kind="secondary" small onPress={() => pickPhoto(true)} style={{ flex: 1 }} />
              ) : null}
              <Button title={Platform.OS === 'web' ? 'Upload photo' : 'From photos'} icon="photo" kind="secondary" small onPress={() => pickPhoto(false)} style={{ flex: 1 }} />
            </Row>
            <Text variant="caption" faint>
              {pro ? 'With Pro, Tripley reads the items and prices for you.' : 'Kept as proof. Pro can read the items for you.'}
            </Text>
          </>
        )}
        {scanInfo ? <Banner tone="success" icon="sparkles">{scanInfo}</Banner> : null}
      </Card>

      <Field label="What was it?" testID="bill-title" value={title} onChangeText={setTitle} placeholder="Dinner at the beach shack" maxLength={120} />

      <View style={{ gap: 6 }}>
        <Text variant="label" muted>Who paid?</Text>
        <Row style={{ flexWrap: 'wrap' }}>
          {members.map((m) => (
            <Chip key={m.user_id} label={nameFor(m)} selected={(paidBy || me) === m.user_id} onPress={() => setPaidBy(m.user_id)} />
          ))}
        </Row>
      </View>

      <Row gap={space.md} align="flex-start">
        <View style={{ flex: 1 }}>
          <CurrencyPicker label="Currency" value={currency} onChange={setCurrency} />
        </View>
        <Field label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" style={{ flex: 1 }} autoCapitalize="none" />
      </Row>
      {currency !== base ? (
        <Field
          label={`1 ${currency} = ? ${base}`}
          value={rateText}
          onChangeText={setRateText}
          keyboardType="decimal-pad"
          hint={rateNote ?? undefined}
          error={!rateOk && rateText ? 'Enter a positive number.' : null}
        />
      ) : null}

      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'itemized', label: 'Who had what' },
          { value: 'equal', label: 'Split equally' },
        ]}
      />

      {mode === 'itemized' ? (
        <Stack gap={space.sm}>
          <SectionTitle action={unassignedCount > 0 ? <Button title="Everyone shared the rest" kind="ghost" small onPress={assignRemainingToEveryone} /> : undefined}>
            Items
          </SectionTitle>
          {items.map((it, index) => (
            <ItemEditor
              key={it.key}
              item={it}
              index={index}
              currency={currency}
              members={members}
              nameFor={nameFor}
              onChange={(patch) => updateItem(it.key, patch)}
              onToggle={(u) => toggle(it.key, u)}
              onBump={(u) => bump(it.key, u)}
              onAll={() => assignAll(it.key)}
              onRemove={items.length > 1 ? () => setItems((l) => l.filter((x) => x.key !== it.key)) : undefined}
            />
          ))}
          <Button title="Add item" icon="add" kind="secondary" small onPress={() => setItems((l) => [...l, emptyItem()])} testID="add-item" />
          <Text variant="caption" faint>Tap names to say who had each item. Long-press a name to give them a bigger part (e.g. 2 of 3 slices).</Text>

          <Card>
            <Text variant="label">Tax, service, tip &amp; discounts</Text>
            <Row gap={space.md}>
              <Field label="Tax" value={taxText} onChangeText={setTaxText} keyboardType="decimal-pad" placeholder="0" style={{ flex: 1 }} />
              <Field label="Service" value={serviceText} onChangeText={setServiceText} keyboardType="decimal-pad" placeholder="0" style={{ flex: 1 }} />
            </Row>
            <Row gap={space.md}>
              <Field label="Tip" value={tipText} onChangeText={setTipText} keyboardType="decimal-pad" placeholder="0" style={{ flex: 1 }} />
              <Field label="Discount" value={discountText} onChangeText={setDiscountText} keyboardType="decimal-pad" placeholder="0" style={{ flex: 1 }} />
            </Row>
            <Text variant="caption" faint>Shared in proportion to what each person had.</Text>
          </Card>
        </Stack>
      ) : (
        <Card>
          <Field label={`Total (${currency})`} testID="equal-total" value={equalTotalText} onChangeText={setEqualTotalText} keyboardType="decimal-pad" placeholder="0.00" />
          <Text variant="label" muted>Split between</Text>
          <Row style={{ flexWrap: 'wrap' }}>
            {members.map((m) => {
              const on = participants.includes(m.user_id);
              return (
                <Chip
                  key={m.user_id}
                  label={nameFor(m)}
                  selected={on}
                  onPress={() => setEqualPeople(on ? participants.filter((u) => u !== m.user_id) : [...participants, m.user_id])}
                />
              );
            })}
          </Row>
        </Card>
      )}

      <Field label="Note (optional)" value={notes} onChangeText={setNotes} placeholder="Anything to remember" maxLength={1000} />

      {/* Live split preview */}
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="heading">Everyone&apos;s share</Text>
          <Text variant="money">{formatMoney(Math.max(0, split.totalMinor), currency)}</Text>
        </Row>
        {mismatch ? (
          <Banner tone="warning">
            The receipt says {formatMoney(receiptTotal!, currency)} but the items add up to {formatMoney(split.totalMinor, currency)}. Check the prices or tax.
          </Banner>
        ) : null}
        {split.issues.length > 0 && split.totalMinor >= 0 ? (
          <Text variant="caption" color={t.warning}>{[...new Set(split.issues.map(describeIssue))].slice(0, 3).join(' ')}</Text>
        ) : null}
        {split.shares.map((s) => {
          const m = members.find((x) => x.user_id === s.userId);
          const conv = converted.find((c) => c.userId === s.userId);
          return (
            <Row key={s.userId} style={{ justifyContent: 'space-between' }}>
              <Row gap={space.sm}>
                <Avatar id={s.userId} name={m?.profile.display_name ?? '?'} url={m?.profile.avatar_url} size={26} />
                <Text>{m ? nameFor(m) : 'Friend'}</Text>
                {s.userId === (paidBy || me) ? <Text variant="caption" faint>(paid)</Text> : null}
              </Row>
              <View style={{ alignItems: 'flex-end' }}>
                <Text variant="money">{formatMoney(s.totalMinor, currency)}</Text>
                {currency !== base && conv ? <Text variant="caption" muted>{formatMoney(conv.amountBaseMinor, base)}</Text> : null}
              </View>
            </Row>
          );
        })}
      </Card>
      {error ? <Banner tone="danger">{error}</Banner> : null}
    </Screen>
  );
}

function ItemEditor({
  item,
  index,
  currency,
  members,
  nameFor,
  onChange,
  onToggle,
  onBump,
  onAll,
  onRemove,
}: {
  item: DraftItem;
  index: number;
  currency: string;
  members: Member[];
  nameFor: (m: Member) => string;
  onChange: (patch: Partial<DraftItem>) => void;
  onToggle: (userId: string) => void;
  onBump: (userId: string) => void;
  onAll: () => void;
  onRemove?: () => void;
}) {
  const t = useTheme();
  const invalid = item.priceText.trim() !== '' && parseAmount(item.priceText, currency) == null;
  const anyone = Object.values(item.assignees).some((w) => w > 0);
  return (
    <Card style={{ gap: space.sm }}>
      <Row gap={space.sm} align="flex-start">
        <Field
          placeholder={`Item ${index + 1}`}
          value={item.name}
          onChangeText={(name) => onChange({ name })}
          style={{ flex: 2 }}
          testID={`item-name-${index}`}
        />
        <Field
          placeholder="0.00"
          value={item.priceText}
          onChangeText={(priceText) => onChange({ priceText })}
          keyboardType="decimal-pad"
          style={{ flex: 1 }}
          error={invalid ? 'Price?' : null}
          testID={`item-price-${index}`}
        />
        {onRemove ? <IconButton icon="trash" label="Remove item" color={t.textFaint} onPress={onRemove} size={18} /> : null}
      </Row>
      <Row style={{ flexWrap: 'wrap' }} gap={6}>
        {members.map((m) => {
          const w = item.assignees[m.user_id] ?? 0;
          return (
            <Pressable
              key={m.user_id}
              accessibilityRole="button"
              accessibilityState={{ selected: w > 0 }}
              accessibilityLabel={`${nameFor(m)} had ${item.name || `item ${index + 1}`}`}
              testID={`assign-${index}-${m.user_id}`}
              onPress={() => onToggle(m.user_id)}
              onLongPress={() => onBump(m.user_id)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingVertical: 4,
                paddingLeft: 4,
                paddingRight: 10,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: w > 0 ? t.primary : t.border,
                backgroundColor: w > 0 ? t.primarySoft : t.surface,
                opacity: pressed ? 0.75 : 1,
              })}>
              <Avatar id={m.user_id} name={m.profile.display_name || '?'} url={m.profile.avatar_url} size={22} dimmed={w === 0} />
              <Text variant="caption" style={{ fontWeight: w > 0 ? '600' : '400' }}>
                {nameFor(m)}
                {w > 1 ? ` ×${w}` : ''}
              </Text>
            </Pressable>
          );
        })}
        <Pressable onPress={onAll} accessibilityRole="button" style={{ paddingVertical: 6, paddingHorizontal: 8 }}>
          <Text variant="caption" color={t.primary} style={{ fontWeight: '600' }}>All</Text>
        </Pressable>
      </Row>
      {!anyone && item.priceText.trim() ? (
        <Row gap={4}>
          <Icon name="person" size={14} color={t.warning} />
          <Text variant="caption" color={t.warning}>Who had this?</Text>
        </Row>
      ) : null}
    </Card>
  );
}
