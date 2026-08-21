import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recordDockVerification } from './record-dock-verification';

const mockInsert = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: vi.fn(() => ({ from: mockFrom })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockFrom.mockReturnValue({ insert: mockInsert });
  mockInsert.mockResolvedValue({ error: null });
});

describe('recordDockVerification', () => {
  it('inserts the verification against dock_verifications', async () => {
    await recordDockVerification({
      operatorId: 'op-1',
      packageId: 'pkg-1',
      userId: 'user-1',
      source: 'scan',
    });

    expect(mockFrom).toHaveBeenCalledWith('dock_verifications');
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        operator_id: 'op-1',
        package_id: 'pkg-1',
        verified_by: 'user-1',
        source: 'scan',
      })
    );
  });

  it('stamps verified_at', async () => {
    await recordDockVerification({
      operatorId: 'op-1',
      packageId: 'pkg-1',
      userId: 'user-1',
      source: 'tap',
    });

    const row = mockInsert.mock.calls[0][0];
    expect(typeof row.verified_at).toBe('string');
    expect(Number.isNaN(Date.parse(row.verified_at))).toBe(false);
  });

  // Re-scanning a CTN already on the pile must stay a no-op — the partial
  // unique index is what makes verification idempotent.
  it('treats a unique violation as a no-op', async () => {
    mockInsert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } });

    await expect(
      recordDockVerification({
        operatorId: 'op-1',
        packageId: 'pkg-1',
        userId: 'user-1',
        source: 'scan',
      })
    ).resolves.toBeUndefined();
  });

  it('throws on any other error', async () => {
    mockInsert.mockResolvedValue({ error: { code: '42501', message: 'permission denied' } });

    await expect(
      recordDockVerification({
        operatorId: 'op-1',
        packageId: 'pkg-1',
        userId: 'user-1',
        source: 'scan',
      })
    ).rejects.toMatchObject({ code: '42501' });
  });
});
