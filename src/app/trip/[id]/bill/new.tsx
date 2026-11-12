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
import { DateTimeField } from '@/components/DateTimeField';
import { Icon } from '@/components/Icon';
import { Avatar, Banner, Button, Card, Chip, Field, IconButton, Loading, Row, Screen, SectionTitle, Segmented, Stack, Text } from '@/components/ui';
import { isPro, receiptUrl, saveBill, ScanError, scanReceipt, updateStay, uploadReceipt, type SaveBillPayload } from '@/lib/api';
import { decodePrefill, type BillPrefill } from '@/lib/stays';
import { convertMinor, fetchExchangeRate, formatMoney, minorToInput, parseAmount } from '@/lib/currency';
import { errorMessage, isNetworkError } from '@/lib/errors';
import { firstName, isISODate, todayISO } from '@/lib/format';
import { nearbyPeople } from '@/lib/geo';
import { newClientId } from '@/lib/ids';
import { queueBill } from '@/lib/outbox';
import { keys, useAccount, useBill, useKitties, useLocations } from '@/lib/queries';
import { receiptToDraft } from '@/lib/receipt';
import { computeSplit, convertShares, describeIssue, type SplitResult } from '@/lib/split';
import { useTripId } from '@/lib/trip-context';
import { useTripData } from '@/lib/trip-hooks';
import type { BillDetail, Member, Trip } from '@/lib/types';
import { useKittySummaries } from '@/lib/use-kitties';
import { radius, space, useTheme } from '@/theme';

type DraftItem = { key: string; name: string; priceText: string; assignees: Record<string, number> };

let keySeq = 0;
const newKey = () => `i${Date.now().toString(36)}${(keySeq++).toString(36)}`;
const emptyItem = (): DraftItem => ({ key: newKey(), name: '', priceText: '', assignees: {} });

export default function BillEditor() {
  const id = useTripId();
  const { billId, kitty, prefill } = useLocalSearchParams<{ billId?: string; kitty?: string; prefill?: string }>();
  const { trip, me, members, loading } = useTripData(id);
  const account = useAccount();
  const existing = useBill(billId ?? '');
  const kittyList = useKitties(id);

  if (loading || !trip || (billId && existing.isLoading) || (kitty && kittyList.isLoading)) return <Loading />;
  return (
    <BillForm
      key={billId ?? 'new'}
      tripId={id}
      billId={billId}
      trip={trip}
      me={me}
      members={members}
      pro={isPro(account.data)}
      initial={billId ? existing.data ?? null : null}
      initialKittyId={kitty}
      prefill={billId ? null : decodePrefill(prefill, members.map((m) => m.user_id))}
    />
  );
}

function BillForm({
  tripId: id,
  billId,
  trip,
  me,
  members,
  pro,
  initial: b,
  initialKittyId,
  prefill,
}: {
  tripId: string;
  billId?: string;
  trip: Trip;
  me: string;
  members: Member[];
  pro: boolean;
  initial: BillDetail | null;
  initialKittyId?: string;
  /** Items worked out elsewhere (e.g. a stay split by room), to review and save. */
  prefill?: BillPrefill | null;
}) {
  const t = useTheme();
  const qc = useQueryClient();
  const base = trip.base_currency;
  const itemized = !b || b.split_mode === 'itemized';
  const initialMoney = (minor: number | undefined) => (b && minor ? minorToInput(minor, b.currency) : '');

  const [title, setTitle] = useState(b?.title ?? prefill?.title ?? '');
  const kitties = useKittySummaries(id);
  const startKitty = b ? b.kitty_id : kitties.find((k) => k.kitty.id === initialKittyId && !k.kitty.closed_at) ?? null;
  const [kittyId, setKittyId] = useState<string | null>(
    typeof startKitty === 'string' ? startKitty : startKitty ? startKitty.kitty.id : null,
  );
  const [paidBy, setPaidBy] = useState(b?.paid_by ?? (startKitty && typeof startKitty !== 'string' ? startKitty.kitty.holder_id : me));
  const [fxSource, setFxSource] = useState<'ecb' | 'manual' | null>(b?.fx_source ?? null);
  // One id per new bill, so saving it again after being offline can't add it twice.
  const [clientId] = useState(() => newClientId());
  const [openedAt] = useState(() => Date.now());
  const locations = useLocations(id);
  const [groupMode, setGroupMode] = useState<'nearby' | 'everyone'>('nearby');
  const [date, setDate] = useState(b?.bill_date ?? todayISO());
  const [currency, setCurrencyState] = useState(b?.currency ?? base);
  const [rateText, setRateText] = useState(b ? String(b.fx_rate) : '1');
  const [rateNote, setRateNote] = useState<string | null>(null);
  const [mode, setMode] = useState<'itemized' | 'equal'>(b?.split_mode ?? 'itemized');
  const [items, setItems] = useState<DraftItem[]>(() =>
    b && b.split_mode === 'itemized'
      ? b.bill_items.map((it) => ({
          key: newKey(),
          name: it.name,
          priceText: minorToInput(it.line_total_minor, b.currency),
          assignees: Object.fromEntries(it.bill_item_shares.map((s) => [s.user_id, s.weight])),
        }))
      : prefill
        ? prefill.items.map((it) => ({
            key: newKey(),
            name: it.name,
            priceText: minorToInput(it.minor, base),
            assignees: Object.fromEntries(it.people.map((u) => [u, 1])),
          }))
        : [emptyItem()],
  );
  const [taxText, setTaxText] = useState(itemized ? initialMoney(b?.tax_minor) : '');
  const [serviceText, setServiceText] = useState(itemized ? initialMoney(b?.service_minor) : '');
  const [tipText, setTipText] = useState(itemized ? initialMoney(b?.tip_minor) : '');
  const [discountText, setDiscountText] = useState(itemized ? initialMoney(b?.discount_minor) : '');
  const [equalTotalText, setEqualTotalText] = useState(!itemized && b ? minorToInput(b.total_minor, b.currency) : '');
  const [equalPeople, setEqualPeople] = useState<string[] | null>(!itemized && b ? b.bill_shares.map((s) => s.user_id) : null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [receiptPath, setReceiptPath] = useState<string | null>(b?.receipt_path ?? null);
  const [source, setSource] = useState<'manual' | 'ai'>(b?.source ?? 'manual');
  const [receiptTotal, setReceiptTotal] = useState<number | null>(null);
  const [notes, setNotes] = useState(b?.notes ?? '');
  const [scanning, setScanning] = useState(false);
  const [scanInfo, setScanInfo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rateRequest = useRef(0);
  // Same request id for the same photo, so scanning it again isn't charged twice.
  const scanIds = useRef(new Map<string, string>());

  // Show the saved receipt photo when editing.
  useEffect(() => {
    if (!b?.receipt_path) return;
    let cancelled = false;
    receiptUrl(b.receipt_path).then((u) => {
      if (!cancelled && u) setPhotoUri((current) => current ?? u);
    });
    return () => {
      cancelled = true;
    };
  }, [b?.receipt_path]);

  /** Look up the exchange rate for a foreign-currency bill (ECB rates). */
  const lookupRate = (code: string, day: string) => {
    if (code === base) return;
    const request = ++rateRequest.current;
    setRateNote('Looking up the exchange rate…');
    fetchExchangeRate(code, base, isISODate(day) ? day : undefined).then((rate) => {
      if (request !== rateRequest.current) return;
      if (rate) {
        setRateText(String(Number(rate.toFixed(6))));
        setFxSource('ecb');
        setRateNote(
          `European Central Bank rate for ${isISODate(day) ? day : 'today'}. It's locked when you save, so later swings don't change anyone's share. Change it to match what you actually paid.`,
        );
      } else {
        setRateText('');
        setFxSource('manual');
        setRateNote(`We couldn't find a rate for ${code}. Enter how many ${base} one ${code} was.`);
      }
    });
  };
  const setCurrency = (code: string, day = date) => {
    setCurrencyState(code);
    lookupRate(code, day);
  };
  const changeDate = (value: string) => {
    setDate(value);
    if (isISODate(value) && currency !== base) lookupRate(currency, value);
  };

  const everyone = members.map((m) => m.user_id);
  // "Meet up at the bill": for a new bill, pick the people who were near whoever paid.
  const nearby = useMemo(() => {
    if (b) return null;
    const payer = paidBy || me;
    const located = (locations.data ?? []).map((l) => ({ userId: l.user_id, lat: l.lat, lng: l.lng, updatedAt: l.updated_at }));
    const at = located.find((l) => l.userId === payer);
    if (!at || openedAt - Date.parse(at.updatedAt) > 30 * 60_000) return null;
    const ids = nearbyPeople(at, located, { now: openedAt }).filter((u) => everyone.includes(u));
    if (!ids.includes(payer)) ids.push(payer);
    return ids.length >= 2 && ids.length < everyone.length ? ids : null;
  }, [b, paidBy, me, locations.data, openedAt, everyone]);
  const group = nearby && groupMode === 'nearby' ? nearby : everyone;
  const participants = equalPeople ?? group;
  const participantsKey = participants.join(',');
  const rate = Number(rateText.replace(',', '.'));
  const rateOk = currency === base || (Number.isFinite(rate) && rate > 0);

  const split: SplitResult = useMemo(() => {
    const money = (text: string) => (text.trim() ? parseAmount(text, currency) : 0);
    if (mode === 'equal') {
      return computeSplit({
        mode: 'equal',
        totalMinor: money(equalTotalText) ?? -1,
        participants: participantsKey ? participantsKey.split(',') : [],
      });
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
  }, [mode, items, taxText, serviceText, tipText, discountText, equalTotalText, participantsKey, currency]);
  const money = (text: string) => (text.trim() ? parseAmount(text, currency) : 0);

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
    updateItem(key, { assignees: Object.fromEntries(group.map((u) => [u, 1])) });
  const assignRemainingToEveryone = () =>
    setItems((list) =>
      list.map((it) =>
        Object.values(it.assignees).some((w) => w > 0) ? it : { ...it, assignees: Object.fromEntries(group.map((u) => [u, 1])) },
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
      let requestId = scanIds.current.get(path);
      if (!requestId) {
        requestId = newClientId();
        scanIds.current.set(path, requestId);
      }
      const { receipt, scans_left } = await scanReceipt(path, id, base, requestId);
      const draft = receiptToDraft(receipt, currency);
      if (!title.trim() && draft.title) setTitle(draft.title);
      if (draft.date) setDate(draft.date);
      if (draft.currency !== currency) setCurrency(draft.currency, draft.date ?? date);
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

  // Back to where you came from, or the bills list when opened directly (a link, a reload).
  const leave = () =>
    prefill?.stayId
      ? router.dismissTo(`/trip/${id}/stays`)
      : router.canGoBack()
        ? router.back()
        : router.replace({ pathname: '/trip/[id]/bills', params: { id } });

  const save = async () => {
    setError(null);
    if (!title.trim()) return setError('Give the bill a name, e.g. "Dinner".');
    if (!isISODate(date)) return setError('The date should look like 2026-11-08.');
    if (!rateOk) return setError(`Enter the exchange rate: how many ${base} one ${currency} was.`);
    if (!split.ok) return setError(split.issues.map(describeIssue).join(' '));
    if (split.totalMinor <= 0) return setError('The bill total is zero.');
    setSaving(true);
    let payload: SaveBillPayload | null = null;
    let photoLeftOut = false;
    try {
      let path: string | null = null;
      try {
        path = await ensureUploaded();
      } catch (e) {
        // No connection: keep the bill, leave the photo out.
        if (billId || !isNetworkError(e)) throw e;
        photoLeftOut = true;
      }
      const baseById = new Map(converted.map((c) => [c.userId, c.amountBaseMinor]));
      payload = {
        id: billId || undefined,
        client_id: billId ? undefined : clientId,
        kitty_id: kittyId,
        fx_source: currency === base ? null : fxSource ?? 'manual',
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
      if (photoLeftOut) throw new TypeError('Network request failed');
      const savedId = await saveBill(payload);
      if (prefill?.stayId) {
        // Best effort: the stay shows its bill. Only whoever arranges it may link it.
        await updateStay(prefill.stayId, { bill_id: savedId }).catch(() => {});
        qc.invalidateQueries({ queryKey: keys.stays(id) });
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.bills(id) }),
        qc.invalidateQueries({ queryKey: keys.shares(id) }),
        qc.invalidateQueries({ queryKey: keys.bill(savedId) }),
      ]);
      leave();
    } catch (e) {
      if (!billId && payload && isNetworkError(e)) {
        // Offline: keep it on this device and send it when the connection is back.
        await queueBill({
          clientId,
          userId: me,
          tripId: id,
          title: payload.title,
          totalMinor: payload.total_minor,
          currency,
          payload: { ...payload, receipt_path: null },
        });
        leave();
        return;
      }
      setError(billId && isNetworkError(e) ? 'You’re offline. Changes to a saved bill need a connection.' : errorMessage(e));
      setSaving(false);
    }
  };

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
            <Chip
              key={m.user_id}
              label={nameFor(m)}
              selected={!kittyId && (paidBy || me) === m.user_id}
              onPress={() => {
                setKittyId(null);
                setPaidBy(m.user_id);
              }}
            />
          ))}
          {kitties
            .filter((k) => !k.kitty.closed_at || k.kitty.id === kittyId)
            .map((k) => (
              <Chip
                key={k.kitty.id}
                testID={`paid-from-kitty-${k.kitty.id}`}
                label={`💵 ${k.kitty.name} (${k.kitty.holder_id === me ? 'you hold it' : `${firstName(members.find((m) => m.user_id === k.kitty.holder_id)?.profile.display_name || 'Friend')} has it`})`}
                selected={kittyId === k.kitty.id}
                onPress={() => {
                  setKittyId(k.kitty.id);
                  setPaidBy(k.kitty.holder_id);
                }}
              />
            ))}
        </Row>
        {kittyId
          ? (() => {
              const k = kitties.find((x) => x.kitty.id === kittyId);
              if (!k) return null;
              const after = k.summary.cashMinor - (billId && b?.kitty_id === kittyId ? 0 : totalBase);
              return (
                <Text variant="caption" color={after < 0 ? t.warning : t.textMuted}>
                  Paid from the kitty: {formatMoney(k.summary.cashMinor, base)} in it now
                  {totalBase > 0 && !billId ? `, ${formatMoney(Math.max(after, 0), base)} left after this` : ''}.
                  {after < 0 ? ' That’s more than is in the kitty; someone may have added cash without recording it.' : ''}
                </Text>
              );
            })()
          : null}
      </View>

      {nearby ? (
        <Banner
          tone="info"
          icon="location"
          title={groupMode === 'nearby' ? `Split between the ${nearby.length} of you here` : 'Split with everyone on the trip'}
          action={
            <Button
              title={groupMode === 'nearby' ? 'Include everyone' : `Only the ${nearby.length} who were here`}
              small
              kind="secondary"
              testID="toggle-nearby"
              onPress={() => {
                setGroupMode((m) => (m === 'nearby' ? 'everyone' : 'nearby'));
                setEqualPeople(null);
              }}
            />
          }>
          {groupMode === 'nearby'
            ? `${nearby
                .filter((u) => u !== (paidBy || me))
                .map((u) => (u === me ? 'You' : firstName(members.find((m) => m.user_id === u)?.profile.display_name || 'Friend')))
                .join(', ')} ${nearby.length > 2 ? 'were' : 'was'} within 150 m, so they're picked for this bill.`
            : 'Everyone on the trip is picked. Untick anyone who wasn’t there.'}
        </Banner>
      ) : null}

      <Row gap={space.md} align="flex-start">
        <View style={{ flex: 1 }}>
          <CurrencyPicker label="Currency" value={currency} onChange={(code) => setCurrency(code)} />
        </View>
        <DateTimeField mode="date" label="Date" value={date} onChangeText={changeDate} style={{ flex: 1 }} testID="bill-date" />
      </Row>
      {currency !== base ? (
        <Field
          label={`1 ${currency} = ? ${base}`}
          value={rateText}
          onChangeText={(v) => {
            setRateText(v);
            setFxSource('manual');
          }}
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
              allLabel={group.length < everyone.length ? 'All here' : 'All'}
              onRemove={items.length > 1 ? () => setItems((l) => l.filter((x) => x.key !== it.key)) : undefined}
            />
          ))}
          <Button title="Add item" icon="add" kind="secondary" small onPress={() => setItems((l) => [...l, emptyItem()])} testID="add-item" />
          <Text variant="caption" faint>Tap names to say who had each item. Long-press a name to give them a bigger part (e.g. 2 of 3 slices).</Text>

          <Card>
            <Text variant="label">Tax, service, tip &amp; discounts</Text>
            <Row gap={space.md}>
              <Field label="Tax" testID="tax-input" value={taxText} onChangeText={setTaxText} keyboardType="decimal-pad" placeholder="0" style={{ flex: 1 }} />
              <Field label="Service" testID="service-input" value={serviceText} onChangeText={setServiceText} keyboardType="decimal-pad" placeholder="0" style={{ flex: 1 }} />
            </Row>
            <Row gap={space.md}>
              <Field label="Tip" testID="tip-input" value={tipText} onChangeText={setTipText} keyboardType="decimal-pad" placeholder="0" style={{ flex: 1 }} />
              <Field label="Discount" testID="discount-input" value={discountText} onChangeText={setDiscountText} keyboardType="decimal-pad" placeholder="0" style={{ flex: 1 }} />
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
  allLabel = 'All',
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
  allLabel?: string;
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
          <Text variant="caption" color={t.primary} style={{ fontWeight: '600' }}>{allLabel}</Text>
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
