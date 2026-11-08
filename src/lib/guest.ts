import type { User } from '@supabase/supabase-js';

import { supabase } from './supabase';

/** Sign in without phone or email. The name becomes the profile's display name. */
export async function signInAsGuest(name: string): Promise<void> {
  const fullName = name.trim().slice(0, 60);
  if (!fullName) throw new Error('Type your name so friends know who you are.');
  const { error } = await supabase.auth.signInAnonymously({ options: { data: { full_name: fullName } } });
  if (error) {
    if (/anonymous/i.test(error.message)) throw new Error('Guest sign-in is turned off right now.');
    throw error;
  }
}

export function isGuest(user: User | null | undefined): boolean {
  return Boolean(user?.is_anonymous);
}
