import AsyncStorage from '@react-native-async-storage/async-storage';

// Remembers an invite link opened before signing in, so we can finish joining after.
const KEY = 'tripley.pendingJoin';

export const setPendingJoin = (code: string) => AsyncStorage.setItem(KEY, code);
export const clearPendingJoin = () => AsyncStorage.removeItem(KEY);
export const peekPendingJoin = () => AsyncStorage.getItem(KEY);
export async function takePendingJoin(): Promise<string | null> {
  const code = await AsyncStorage.getItem(KEY);
  if (code) await AsyncStorage.removeItem(KEY);
  return code;
}
