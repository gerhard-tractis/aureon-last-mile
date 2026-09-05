import { describe, it, expect, vi } from 'vitest';
import {
  claimDispatchAttempt,
  releaseDispatchClaim,
  DISPATCH_CLAIM_STALE_MS,
} from '@/lib/dispatch/dispatch-retry-claim';

/**
 * spec-79 Fase 4, review finding 4: `route.external_route_id` is a READ
 * acted on much later, with nothing claiming the route in between — two
 * concurrent POSTs can both read it unset and both call DispatchTrack.
 * `dispatch_attempt_at` is a one-shot claim column: `claimDispatchAttempt`
 * takes it, `releaseDispatchClaim` gives it back on any terminal path that
 * did NOT reach DispatchTrack (or that DT definitively rejected/confirmed).
 * A claim left behind by a crashed request must not be a permanent lock —
 * see the "stale reclaim" tests below.
 */

function freshClaimChain(touchedRows: Array<{ id: string }> | null) {
  const selectMock = vi.fn().mockResolvedValue({ data: touchedRows, error: null });
  const isDeletedMock = vi.fn().mockReturnValue({ select: selectMock });
  const isAttemptMock = vi.fn().mockReturnValue({ is: isDeletedMock });
  const eqOperatorMock = vi.fn().mockReturnValue({ is: isAttemptMock });
  const eqIdMock = vi.fn().mockReturnValue({ eq: eqOperatorMock });
  const updateMock = vi.fn().mockReturnValue({ eq: eqIdMock });
  return { update: updateMock, selectMock, isAttemptMock, isDeletedMock, eqOperatorMock, eqIdMock };
}

function staleClaimChain(touchedRows: Array<{ id: string }> | null) {
  const selectMock = vi.fn().mockResolvedValue({ data: touchedRows, error: null });
  const isDeletedMock = vi.fn().mockReturnValue({ select: selectMock });
  const ltMock = vi.fn().mockReturnValue({ is: isDeletedMock });
  const eqOperatorMock = vi.fn().mockReturnValue({ lt: ltMock });
  const eqIdMock = vi.fn().mockReturnValue({ eq: eqOperatorMock });
  const updateMock = vi.fn().mockReturnValue({ eq: eqIdMock });
  return { update: updateMock, selectMock, ltMock, isDeletedMock, eqOperatorMock, eqIdMock };
}

function errorChain(error: unknown) {
  const selectMock = vi.fn().mockResolvedValue({ data: null, error });
  const chain: Record<string, unknown> = {};
  chain.select = selectMock;
  chain.is = vi.fn().mockReturnValue(chain);
  chain.lt = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  return { update: vi.fn().mockReturnValue(chain), selectMock };
}

describe('claimDispatchAttempt', () => {
  it('claims fresh when dispatch_attempt_at is NULL — wasStale is false, and returns the attemptToken it stamped', async () => {
    const fresh = freshClaimChain([{ id: 'r1' }]);
    const supabase = { from: vi.fn().mockReturnValue(fresh) };

    const result = await claimDispatchAttempt(supabase as never, { routeId: 'r1', operatorId: 'op-1' });

    expect(result.claimed).toBe(true);
    if (!result.claimed) throw new Error('unreachable');
    expect(result.wasStale).toBe(false);
    expect(typeof result.attemptToken).toBe('string');
    // Only the fresh-claim query ran — no need to even attempt the stale path.
    expect(supabase.from).toHaveBeenCalledTimes(1);
    expect(fresh.isAttemptMock).toHaveBeenCalledWith('dispatch_attempt_at', null);
  });

  it('refuses when a fresh claim already exists and is not stale', async () => {
    const fresh = freshClaimChain([]); // 0 rows: dispatch_attempt_at already set
    const stale = staleClaimChain([]); // 0 rows: not old enough to reclaim
    const supabase = { from: vi.fn().mockReturnValueOnce(fresh).mockReturnValueOnce(stale) };

    const result = await claimDispatchAttempt(supabase as never, { routeId: 'r1', operatorId: 'op-1' });

    expect(result).toEqual({ claimed: false });
    expect(supabase.from).toHaveBeenCalledTimes(2);
  });

  it('reclaims a stale attempt (older than DISPATCH_CLAIM_STALE_MS) — wasStale is true, with its own attemptToken', async () => {
    const fresh = freshClaimChain([]); // fresh claim fails: already set
    const stale = staleClaimChain([{ id: 'r1' }]); // stale reclaim succeeds
    const supabase = { from: vi.fn().mockReturnValueOnce(fresh).mockReturnValueOnce(stale) };

    const result = await claimDispatchAttempt(supabase as never, { routeId: 'r1', operatorId: 'op-1' });

    expect(result.claimed).toBe(true);
    if (!result.claimed) throw new Error('unreachable');
    expect(result.wasStale).toBe(true);
    expect(typeof result.attemptToken).toBe('string');
    // The stale-reclaim cutoff must actually be DISPATCH_CLAIM_STALE_MS in the past.
    const cutoffArg = stale.ltMock.mock.calls[0][1] as string;
    const cutoffAgeMs = Date.now() - new Date(cutoffArg).getTime();
    expect(cutoffAgeMs).toBeGreaterThanOrEqual(DISPATCH_CLAIM_STALE_MS - 1000);
    expect(cutoffAgeMs).toBeLessThan(DISPATCH_CLAIM_STALE_MS + 5000);
  });

  it('fails CLOSED (refuses) when the fresh-claim query itself errors', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const supabase = { from: vi.fn().mockReturnValue(errorChain({ message: 'db down' })) };

    const result = await claimDispatchAttempt(supabase as never, { routeId: 'r1', operatorId: 'op-1' });

    expect(result).toEqual({ claimed: false });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('fails CLOSED (refuses) when the stale-reclaim query itself errors', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fresh = freshClaimChain([]);
    const supabase = {
      from: vi.fn().mockReturnValueOnce(fresh).mockReturnValueOnce(errorChain({ message: 'db down' })),
    };

    const result = await claimDispatchAttempt(supabase as never, { routeId: 'r1', operatorId: 'op-1' });

    expect(result).toEqual({ claimed: false });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('scopes every query by operator_id and excludes soft-deleted routes', async () => {
    const fresh = freshClaimChain([{ id: 'r1' }]);
    const supabase = { from: vi.fn().mockReturnValue(fresh) };

    await claimDispatchAttempt(supabase as never, { routeId: 'r1', operatorId: 'op-1' });

    expect(fresh.eqIdMock).toHaveBeenCalledWith('id', 'r1');
    expect(fresh.eqOperatorMock).toHaveBeenCalledWith('operator_id', 'op-1');
    expect(fresh.isDeletedMock).toHaveBeenCalledWith('deleted_at', null);
  });
});

describe('releaseDispatchClaim', () => {
  it('sets dispatch_attempt_at back to NULL, scoped by id, operator_id, AND the exact attemptToken it was given', async () => {
    const eqTokenMock = vi.fn().mockResolvedValue({ error: null });
    const eqOperatorMock = vi.fn().mockReturnValue({ eq: eqTokenMock });
    const eqIdMock = vi.fn().mockReturnValue({ eq: eqOperatorMock });
    const updateMock = vi.fn().mockReturnValue({ eq: eqIdMock });
    const supabase = { from: vi.fn().mockReturnValue({ update: updateMock }) };

    await releaseDispatchClaim(supabase as never, { routeId: 'r1', operatorId: 'op-1', attemptToken: 'tok-123' });

    expect(updateMock).toHaveBeenCalledWith({ dispatch_attempt_at: null });
    expect(eqIdMock).toHaveBeenCalledWith('id', 'r1');
    expect(eqOperatorMock).toHaveBeenCalledWith('operator_id', 'op-1');
    expect(eqTokenMock).toHaveBeenCalledWith('dispatch_attempt_at', 'tok-123');
  });

  it('logs but does not throw when the release write fails — best-effort, like every other release in this flow', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const eqTokenMock = vi.fn().mockResolvedValue({ error: { message: 'db down' } });
    const eqOperatorMock = vi.fn().mockReturnValue({ eq: eqTokenMock });
    const eqIdMock = vi.fn().mockReturnValue({ eq: eqOperatorMock });
    const updateMock = vi.fn().mockReturnValue({ eq: eqIdMock });
    const supabase = { from: vi.fn().mockReturnValue({ update: updateMock }) };

    await expect(
      releaseDispatchClaim(supabase as never, { routeId: 'r1', operatorId: 'op-1', attemptToken: 'tok-123' }),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  /**
   * route.ts's early-exit paths call this before responding — if the chain
   * itself throws (not just resolves an `error` field) this must still not
   * propagate, or a release failure would turn e.g. a 422 VEHICLE_NOT_FOUND
   * into an unrelated 502 for a DT call that never happened.
   */
  it('logs but does not throw when the underlying call itself throws synchronously', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const supabase = { from: vi.fn().mockReturnValue(undefined) };

    await expect(
      releaseDispatchClaim(supabase as never, { routeId: 'r1', operatorId: 'op-1', attemptToken: 'tok-123' }),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
