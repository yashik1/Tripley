/**
 * Your appearance (System, Light or Dark) and colour palette.
 *
 * Saved on your profile, so every device you sign in on matches, and kept on
 * this device too, so the app opens in your colours before the profile has
 * loaded (on the web, from the very first frame). Signed out: System and Teal.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Appearance, Platform } from 'react-native';

import { updateProfile } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useAuth } from '@/providers/AuthProvider';
import {
  DEFAULT_PREFS,
  isAppearancePref,
  isPaletteKey,
  ThemePrefsContext,
  useTheme,
  type AppearancePref,
  type PaletteKey,
  type ThemePrefs,
} from '@/theme';

const KEY = 'tripley.theme';
type Saved = { owner: string; appearance: AppearancePref; palette: PaletteKey };

function parse(raw: string | null | undefined): Saved | null {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<Saved>) : null;
    return v && typeof v.owner === 'string' && isAppearancePref(v.appearance) && isPaletteKey(v.palette)
      ? { owner: v.owner, appearance: v.appearance, palette: v.palette }
      : null;
  } catch {
    return null;
  }
}

const web = Platform.OS === 'web';
function readWeb(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

// This device's copy: a tiny store, read synchronously on the web.
let saved: Saved | null = web ? parse(readWeb()) : null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
function setSaved(next: Saved) {
  saved = next;
  emit();
  const raw = JSON.stringify(next);
  if (web) {
    try {
      localStorage.setItem(KEY, raw);
    } catch {
      // Private browsing or storage off: the choice still applies until reload.
    }
  } else AsyncStorage.setItem(KEY, raw).catch(() => undefined);
}
if (!web) {
  AsyncStorage.getItem(KEY)
    .then((raw) => {
      const v = parse(raw);
      if (v && !saved) {
        saved = v;
        emit();
      }
    })
    .catch(() => undefined);
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const snapshot = () => saved;

/** On the web: the page background, form controls and browser bar follow the theme. */
function WebChrome() {
  const t = useTheme();
  useEffect(() => {
    if (!web || typeof document === 'undefined') return;
    document.documentElement.style.colorScheme = t.scheme;
    document.body.style.backgroundColor = t.bg;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.scheme === 'dark' ? t.bg : t.primary);
  }, [t]);
  return null;
}

export function ThemePrefsProvider({ children }: { children: ReactNode }) {
  const { ready, user, profile, refreshProfile } = useAuth();
  const local = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [saveError, setSaveError] = useState<string | null>(null);
  const uid = user?.id ?? null;
  const profileAppearance = isAppearancePref(profile?.appearance) ? profile.appearance : null;
  const profilePalette = isPaletteKey(profile?.palette) ? profile.palette : null;

  // The account's choice wins once the profile has loaded (it may have been changed on another device).
  useEffect(() => {
    if (!uid || !profileAppearance || !profilePalette) return;
    if (saved?.owner !== uid || saved.appearance !== profileAppearance || saved.palette !== profilePalette) {
      setSaved({ owner: uid, appearance: profileAppearance, palette: profilePalette });
    }
  }, [uid, profileAppearance, profilePalette]);

  // Still signing in: this device's copy (so there's no flash). Signed in: yours. Signed out: the defaults.
  const current =
    !ready && local
      ? local
      : uid && local?.owner === uid
        ? local
        : uid && profileAppearance && profilePalette
          ? { appearance: profileAppearance, palette: profilePalette }
          : DEFAULT_PREFS;
  const { appearance, palette } = current;

  // Native pickers, alerts and the keyboard follow your choice too.
  useEffect(() => {
    if (web) return;
    try {
      Appearance.setColorScheme(appearance === 'system' ? 'unspecified' : appearance);
    } catch {
      // Older platforms without an override: the app's own colours still follow.
    }
  }, [appearance]);

  const value = useMemo<ThemePrefs>(() => {
    const apply = (patch: Partial<Pick<Saved, 'appearance' | 'palette'>>) => {
      if (!uid) return;
      setSaved({ owner: uid, appearance, palette, ...patch });
      setSaveError(null);
      updateProfile(patch)
        .then(() => refreshProfile())
        .catch((e) => setSaveError(`Saved on this device only. ${errorMessage(e)}`));
    };
    return {
      appearance,
      palette,
      setAppearance: (a) => apply({ appearance: a }),
      setPalette: (p) => apply({ palette: p }),
      saveError,
    };
  }, [appearance, palette, saveError, uid, refreshProfile]);

  return (
    <ThemePrefsContext.Provider value={value}>
      <WebChrome />
      {children}
    </ThemePrefsContext.Provider>
  );
}
