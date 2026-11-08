import type { Session, User } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { isConfigured } from '@/config';
import { getProfile } from '@/lib/api';
import { keys } from '@/lib/queries';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';

type AuthState = {
  ready: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null | undefined;
  profileLoading: boolean;
  refreshProfile: () => Promise<unknown>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!isConfigured);
  const qc = useQueryClient();

  useEffect(() => {
    if (!isConfigured) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  const profileQuery = useQuery({
    queryKey: keys.profile(userId ?? 'none'),
    queryFn: () => getProfile(userId!),
    enabled: !!userId,
  });

  const value = useMemo<AuthState>(
    () => ({
      ready,
      session,
      user: session?.user ?? null,
      profile: profileQuery.data,
      profileLoading: !!userId && profileQuery.isLoading,
      refreshProfile: () => profileQuery.refetch(),
      signOut: async () => {
        await supabase.auth.signOut();
        qc.clear();
      },
    }),
    [ready, session, userId, profileQuery, qc],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** The signed-in user's id. Only use on screens behind the sign-in guard. */
export function useMyId(): string {
  return useAuth().user?.id ?? '';
}
