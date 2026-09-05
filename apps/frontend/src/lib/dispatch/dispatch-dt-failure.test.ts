import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createSSRClient: vi.fn() }));
vi.mock('@/lib/dispatchtrack-api', () => ({
  DTRejectedError: class DTRejectedError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'DTRejectedError';
    }
  },
}));

import { createSSRClient } from '@/lib/supabase/server';
import { DTRejectedError } from '@/lib/dispatchtrack-api';
import { handleDispatchOuterCatch } from '@/lib/dispatch/dispatch-dt-failure';

function buildClient(releaseUpdateSpy: ReturnType<typeof vi.fn>, auditInsertSpy: ReturnType<typeof vi.fn>) {
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { user: { id: 'u1', app_metadata: { claims: { operator_id: 'op-1' } } } } },
      }),
    },
    from: vi.fn().mockReturnValue({ insert: auditInsertSpy, update: releaseUpdateSpy }),
  };
}

function releaseChain() {
  return vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    }),
  });
}

describe('handleDispatchOuterCatch', () => {
  /**
   * spec-79 H-1 (review round 6): a definite DT rejection is the ONLY case
   * safe to release the claim for early.
   */
  it('releases the claim when the error is a DTRejectedError', async () => {
    const releaseUpdateSpy = releaseChain();
    const auditInsertSpy = vi.fn().mockResolvedValue({ error: null });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(buildClient(releaseUpdateSpy, auditInsertSpy));

    await handleDispatchOuterCatch({
      err: new DTRejectedError('Permission denied'),
      routeId: 'r1',
      claimAttemptToken: 'tok-1',
    });

    expect(releaseUpdateSpy).toHaveBeenCalledWith({ dispatch_attempt_at: null });
    expect(auditInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'dispatch_failed', changes_json: expect.objectContaining({ definitely_rejected: true }) }),
    );
  });

  it('does NOT release the claim for an ambiguous error (network failure/timeout, not DTRejectedError)', async () => {
    const releaseUpdateSpy = releaseChain();
    const auditInsertSpy = vi.fn().mockResolvedValue({ error: null });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(buildClient(releaseUpdateSpy, auditInsertSpy));

    await handleDispatchOuterCatch({
      err: new Error('network timeout — outcome unknown'),
      routeId: 'r1',
      claimAttemptToken: 'tok-1',
    });

    expect(releaseUpdateSpy).not.toHaveBeenCalled();
    expect(auditInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'dispatch_failed', changes_json: expect.objectContaining({ definitely_rejected: false }) }),
    );
  });

  it('does not release when no claim was ever taken (claimAttemptToken null), even on a DTRejectedError', async () => {
    const releaseUpdateSpy = releaseChain();
    const auditInsertSpy = vi.fn().mockResolvedValue({ error: null });
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(buildClient(releaseUpdateSpy, auditInsertSpy));

    await handleDispatchOuterCatch({
      err: new DTRejectedError('rejected'),
      routeId: 'r1',
      claimAttemptToken: null,
    });

    expect(releaseUpdateSpy).not.toHaveBeenCalled();
  });

  it('never throws, even when there is no session', async () => {
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
      from: vi.fn(),
    });

    await expect(
      handleDispatchOuterCatch({ err: new Error('boom'), routeId: 'r1', claimAttemptToken: null }),
    ).resolves.toBeUndefined();
  });

  it('never throws when createSSRClient itself rejects', async () => {
    (createSSRClient as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'));

    await expect(
      handleDispatchOuterCatch({ err: new Error('boom'), routeId: 'r1', claimAttemptToken: null }),
    ).resolves.toBeUndefined();
  });
});
