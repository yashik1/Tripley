import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireEnv } from './env.ts';

export { isUuid } from './http.ts';

/** Service-role client: bypasses RLS. Only use after checking who the caller is. */
export function adminClient(): SupabaseClient {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? requireEnv('SUPABASE_SECRET_KEY');
  return createClient(requireEnv('SUPABASE_URL'), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Client that acts as the calling user, so Row Level Security applies. */
export function userClient(authorization: string): SupabaseClient {
  const key = Deno.env.get('SUPABASE_ANON_KEY') ?? requireEnv('SUPABASE_PUBLISHABLE_KEY');
  return createClient(requireEnv('SUPABASE_URL'), key, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
