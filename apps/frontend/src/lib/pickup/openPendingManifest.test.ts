import { describe, it, expect, vi } from 'vitest';
import { openPendingManifest } from './openPendingManifest';

function chainResolving(data: unknown[]) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['select', 'eq', 'is', 'update']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.limit = vi.fn().mockResolvedValue({ data, error: null });
  return chain;
}

describe('openPendingManifest', () => {
  describe('desktop path (with counts)', () => {
    it('flips a pending manifest to in_progress, stamps started_at, and records the real aggregate counts', async () => {
      const manifestsChain = chainResolving([{ id: 'db-id-1', status: 'pending' }]);
      const supabase = { from: vi.fn().mockReturnValue(manifestsChain) } as any;

      await openPendingManifest(supabase, 'op-1', 'CARGA-001', { orderCount: 5, packageCount: 12 });

      expect(manifestsChain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'in_progress',
          started_at: expect.any(String),
          total_orders: 5,
          total_packages: 12,
        }),
      );
      expect(manifestsChain.eq).toHaveBeenCalledWith('id', 'db-id-1');
    });

    it('does not write when the manifest is already in_progress', async () => {
      const manifestsChain = chainResolving([{ id: 'db-id-1', status: 'in_progress' }]);
      const supabase = { from: vi.fn().mockReturnValue(manifestsChain) } as any;

      await openPendingManifest(supabase, 'op-1', 'CARGA-001', { orderCount: 5, packageCount: 12 });

      expect(manifestsChain.update).not.toHaveBeenCalled();
    });

    it('does not write when no manifest row exists yet', async () => {
      const manifestsChain = chainResolving([]);
      const supabase = { from: vi.fn().mockReturnValue(manifestsChain) } as any;

      await openPendingManifest(supabase, 'op-1', 'CARGA-001', { orderCount: 5, packageCount: 12 });

      expect(manifestsChain.update).not.toHaveBeenCalled();
    });
  });

  // spec-54 3h review fix (round 3, item 1) — the mobile route-card path
  // must still flip status/started_at (started_at has no other writer and
  // drives the pickup/complete duration figure), but must NEVER write
  // total_orders/total_packages, whose source on that path is the nullable
  // manifests.total_packages/total_orders columns.
  describe('mobile route-card path (no counts)', () => {
    it('flips status and stamps started_at without touching total_orders/total_packages', async () => {
      const manifestsChain = chainResolving([{ id: 'db-id-2', status: 'pending' }]);
      const supabase = { from: vi.fn().mockReturnValue(manifestsChain) } as any;

      await openPendingManifest(supabase, 'op-1', 'CARGA-NULL-TOTAL');

      expect(manifestsChain.update).toHaveBeenCalledTimes(1);
      const written = manifestsChain.update.mock.calls[0][0];
      expect(written).toMatchObject({ status: 'in_progress' });
      expect(written.started_at).toEqual(expect.any(String));
      expect(written).not.toHaveProperty('total_orders');
      expect(written).not.toHaveProperty('total_packages');
    });

    it('does not write when the manifest is already in_progress', async () => {
      const manifestsChain = chainResolving([{ id: 'db-id-2', status: 'in_progress' }]);
      const supabase = { from: vi.fn().mockReturnValue(manifestsChain) } as any;

      await openPendingManifest(supabase, 'op-1', 'CARGA-NULL-TOTAL');

      expect(manifestsChain.update).not.toHaveBeenCalled();
    });
  });
});
