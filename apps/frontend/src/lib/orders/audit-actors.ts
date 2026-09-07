import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * `audit_trigger_func()` writes `COALESCE(auth.uid(), '000…0'::uuid)`, so
 * every row written outside a user session — seeds, service-role jobs, the
 * DispatchTrack webhooks — carries this sentinel rather than a real user.
 */
export const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

export type ActorDirectory = Record<string, { full_name: string | null; email: string | null }>;

/**
 * `audit_logs.user_id` has no FK to `users` (verified in QA: the only FK on
 * the table is `operator_id`), so PostgREST cannot embed the user and the
 * names have to be resolved in a second query.
 */
export function actorIdsToResolve(rows: { user_id: string | null }[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.user_id && row.user_id !== SYSTEM_ACTOR_ID) ids.add(row.user_id);
  }
  return [...ids];
}

/** null means "we don't know who" — the caller omits the actor rather than guessing. */
export function actorLabel(userId: string | null, directory: ActorDirectory): string | null {
  if (!userId || userId === SYSTEM_ACTOR_ID) return 'Sistema';
  const actor = directory[userId];
  if (!actor) return null;
  return actor.full_name || actor.email || null;
}

export async function fetchActorDirectory(
  client: SupabaseClient,
  operatorId: string,
  userIds: string[],
): Promise<ActorDirectory> {
  if (userIds.length === 0) return {};

  const { data, error } = await client
    .from('users')
    .select('id, full_name, email')
    .eq('operator_id', operatorId)
    .in('id', userIds);

  // Best-effort: the events themselves are the point, the names are a
  // garnish. A failed lookup must not empty the bitácora.
  if (error || !data) return {};

  const directory: ActorDirectory = {};
  for (const row of data as { id: string; full_name: string | null; email: string | null }[]) {
    directory[row.id] = { full_name: row.full_name, email: row.email };
  }
  return directory;
}
