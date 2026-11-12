import AsyncStorage from '@react-native-async-storage/async-storage';

// Remembers a friend's invite code from a link opened before signing up, to use after.
const KEY = 'tripley.pendingReferral';

export const isReferralCode = (s: string | undefined | null): s is string => !!s && /^[A-HJ-NP-Za-hj-np-z2-9]{8}$/.test(s);
export const setPendingReferral = (code: string) => AsyncStorage.setItem(KEY, code.toUpperCase());
export const clearPendingReferral = () => AsyncStorage.removeItem(KEY);
export async function takePendingReferral(): Promise<string | null> {
  const code = await AsyncStorage.getItem(KEY);
  if (code) await AsyncStorage.removeItem(KEY);
  return code;
}
