import { vi, describe, it, expect, beforeEach } from 'vitest';

const rpcMock = vi.fn();
const getSessionMock = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createSSRClient: vi.fn(async () => ({
    auth: { getSession: getSessionMock },
    rpc: rpcMock,
  })),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

beforeEach(() => {
  rpcMock.mockReset();
  getSessionMock.mockReset();
});

const superAdminSession = {
  data: {
    session: {
      user: { app_metadata: { claims: { role: 'super_admin' } } },
    },
  },
};
const adminSession = {
  data: {
    session: { user: { app_metadata: { claims: { role: 'admin' } } } },
  },
};

describe('module activation server actions (spec-45)', () => {
  it('enableModule rejects non-super-admin', async () => {
    getSessionMock.mockResolvedValue(adminSession);
    const { enableModule } = await import('./actions');
    await expect(enableModule('op-1', 'pickup', 'reason')).rejects.toThrow(
      /access denied/i,
    );
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('enableModule rejects empty reason', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    const { enableModule } = await import('./actions');
    await expect(enableModule('op-1', 'pickup', '')).rejects.toThrow(/reason/i);
  });

  it('enableModule rejects invalid module key', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    const { enableModule } = await import('./actions');
    await expect(enableModule('op-1', 'rogue', 'r')).rejects.toThrow(/invalid module/i);
  });

  it('enableModule calls RPC for super-admin', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    rpcMock.mockResolvedValue({ data: null, error: null });
    const { enableModule } = await import('./actions');
    await enableModule('op-1', 'pickup', 'phase-1 go-live');
    expect(rpcMock).toHaveBeenCalledWith('enable_module_for_operator', {
      p_operator_id: 'op-1',
      p_module_key: 'pickup',
      p_reason: 'phase-1 go-live',
    });
  });

  it('disableModule calls disable RPC', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    rpcMock.mockResolvedValue({ data: null, error: null });
    const { disableModule } = await import('./actions');
    await disableModule('op-1', 'pickup', 'rollback');
    expect(rpcMock).toHaveBeenCalledWith('disable_module_for_operator', {
      p_operator_id: 'op-1',
      p_module_key: 'pickup',
      p_reason: 'rollback',
    });
  });
});
