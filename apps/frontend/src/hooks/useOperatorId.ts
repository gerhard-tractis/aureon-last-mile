import { useGlobal } from '@/lib/context/GlobalContext';

/**
 * The signed-in user's tenancy, role and identity, straight from
 * GlobalContext.
 *
 * `userId` (spec-61 Task 5) is `auth.users.id` — the same value
 * `pickup_routes.driver_id` holds for a route's leader. Screens need it to
 * answer "is this MY route?" (only the route's own leader is offered the
 * cancel) and to keep a leader out of their own crew picker. Read here
 * rather than by calling `useGlobal()` at each site, because `useGlobal`
 * throws outside a GlobalProvider and every one of those sites already
 * mocks this hook.
 */
export function useOperatorId() {
  const { operatorId, role, permissions, user } = useGlobal();
  return { operatorId, role, permissions, userId: user?.id ?? null };
}
