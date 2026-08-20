import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

/**
 * The signed-in user's display name, for screens that need "who is using
 * this device" before any domain-specific record (e.g. an active pickup
 * route) exists to join a name from. `useActivePickupRoute`'s
 * `driver:users(full_name)` join only works once a route row exists — this
 * is the one place before that.
 *
 * Mirrors the pattern already used at
 * `app/pickup/complete/[loadId]/page.tsx`: `auth.getUser()` for the id,
 * then `public.users.full_name` for the real name, falling back to the auth
 * email rather than fabricating one. `useSentryUser.ts` reads
 * `user_metadata.full_name` instead, but that field is not guaranteed to be
 * kept in sync with `public.users.full_name` (the column every other
 * driver-name join in this codebase actually reads) — using the same
 * source of truth here matters more than reusing that one line.
 */
export function useCurrentUserName() {
  return useQuery<string | null>({
    queryKey: ['auth', 'current-user-name'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const supabase = createSPAClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;

      const { data } = await supabase
        .from('users')
        .select('full_name')
        .eq('id', user.id)
        .single();

      return data?.full_name ?? user.email ?? null;
    },
  });
}
