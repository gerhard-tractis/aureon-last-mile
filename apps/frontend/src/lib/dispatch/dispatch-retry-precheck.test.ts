import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/dispatchtrack-api', () => ({ findExistingDTRoute: vi.fn() }));

import { findExistingDTRoute } from '@/lib/dispatchtrack-api';
import { decidePrecheck } from '@/lib/dispatch/dispatch-retry-precheck';

/**
 * spec-79 Fase 4, item 15-16: the GET pre-check runs ONLY when
 * `claimDispatchAttempt` reports `wasStale` — i.e. on the recovery path,
 * never on a genuine first attempt (DT's own rate limit, Fase 0 finding 3).
 * A failed or ambiguous pre-check must refuse, never fall back to creating
 * the route — "a pre-check that fails open is worse than none" (Fase 0's
 * own words).
 */
describe('decidePrecheck', () => {
  it('skips the pre-check entirely on a fresh (non-stale) claim — never calls DT', async () => {
    const result = await decidePrecheck({
      wasStale: false,
      routeDate: '2026-03-24',
      identifiers: ['4821'],
      apiToken: 'token',
    });

    expect(result).toEqual({ action: 'skip_precheck' });
    expect(findExistingDTRoute).not.toHaveBeenCalled();
  });

  it('decides "create" when the pre-check finds no existing DT route', async () => {
    (findExistingDTRoute as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'not_found' });

    const result = await decidePrecheck({
      wasStale: true,
      routeDate: '2026-03-24',
      identifiers: ['4821'],
      apiToken: 'token',
    });

    expect(result).toEqual({ action: 'create' });
    expect(findExistingDTRoute).toHaveBeenCalledWith(
      { routeDate: '2026-03-24', identifiers: ['4821'] },
      'token',
    );
  });

  it('decides "reuse" with the matched id when the pre-check finds an existing DT route', async () => {
    (findExistingDTRoute as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'found',
      external_route_id: '222',
    });

    const result = await decidePrecheck({
      wasStale: true,
      routeDate: '2026-03-24',
      identifiers: ['4821'],
      apiToken: 'token',
    });

    expect(result).toEqual({ action: 'reuse', externalRouteId: '222' });
  });

  it('decides "refuse" when the pre-check is ambiguous', async () => {
    (findExistingDTRoute as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ambiguous' });

    const result = await decidePrecheck({
      wasStale: true,
      routeDate: '2026-03-24',
      identifiers: ['4821'],
      apiToken: 'token',
    });

    expect(result).toEqual({ action: 'refuse' });
  });

  it('decides "refuse" (never "create") when the pre-check itself throws', async () => {
    (findExistingDTRoute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DT list routes error 500'));

    const result = await decidePrecheck({
      wasStale: true,
      routeDate: '2026-03-24',
      identifiers: ['4821'],
      apiToken: 'token',
    });

    expect(result).toEqual({ action: 'refuse' });
  });
});
