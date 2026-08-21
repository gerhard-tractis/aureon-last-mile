import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import { GlobalProvider, useGlobal } from './GlobalContext';

/**
 * Regression: a permission revoked in /admin left the device still showing the
 * module. Claims were read from getSession(), which returns the locally cached
 * session — the copy minted at login. The database row and
 * auth.users.raw_app_meta_data were both correct; only the phone was stale.
 */

type Claims = { operator_id: string; role: string; permissions: string[] };

const makeUser = (claims: Claims) => ({
  id: 'user-1',
  email: 'bodega@musan.com',
  created_at: '2026-01-01T00:00:00Z',
  app_metadata: { claims },
});

const STALE: Claims = {
  operator_id: 'op-1',
  role: 'warehouse_staff',
  permissions: ['reception', 'distribution', 'dispatch'],
};
const FRESH: Claims = { operator_id: 'op-1', role: 'warehouse_staff', permissions: [] };

let getUserResult: { data: { user: ReturnType<typeof makeUser> | null } };
let getSessionResult: { data: { session: { user: ReturnType<typeof makeUser> } | null } };
let authCallback: ((event: string, session: unknown) => void) | null = null;
const unsubscribe = vi.fn();

const authClient = {
  auth: {
    getUser: vi.fn(async () => getUserResult),
    getSession: vi.fn(async () => getSessionResult),
    onAuthStateChange: vi.fn((cb: (event: string, session: unknown) => void) => {
      authCallback = cb;
      return { data: { subscription: { unsubscribe } } };
    }),
  },
};

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => authClient,
  createSPASassClientAuthenticated: async () => ({ getSupabaseClient: () => authClient }),
  createSPASassClient: async () => ({ getSupabaseClient: () => authClient }),
}));

function Probe() {
  const { permissions, role, operatorId } = useGlobal();
  return (
    <div>
      <span data-testid="permissions">{permissions.join(',') || 'none'}</span>
      <span data-testid="role">{role ?? 'none'}</span>
      <span data-testid="operator">{operatorId ?? 'none'}</span>
    </div>
  );
}

const renderProbe = () =>
  render(
    <GlobalProvider>
      <Probe />
    </GlobalProvider>,
  );

beforeEach(() => {
  authCallback = null;
  unsubscribe.mockClear();
  getUserResult = { data: { user: makeUser(FRESH) } };
  getSessionResult = { data: { session: { user: makeUser(STALE) } } };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('GlobalProvider claims', () => {
  it('takes permissions from getUser, not from the cached session', async () => {
    renderProbe();

    await waitFor(() => expect(screen.getByTestId('permissions')).toHaveTextContent('none'));
    expect(screen.getByTestId('role')).toHaveTextContent('warehouse_staff');
    expect(screen.getByTestId('operator')).toHaveTextContent('op-1');
  });

  it('re-reads claims when the access token is refreshed', async () => {
    getUserResult = { data: { user: makeUser(STALE) } };
    renderProbe();

    await waitFor(() =>
      expect(screen.getByTestId('permissions')).toHaveTextContent('reception,distribution,dispatch'),
    );

    await act(async () => {
      authCallback?.('TOKEN_REFRESHED', { user: makeUser(FRESH) });
    });

    expect(screen.getByTestId('permissions')).toHaveTextContent('none');
  });

  it('clears claims on sign-out', async () => {
    getUserResult = { data: { user: makeUser(STALE) } };
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('warehouse_staff'));

    await act(async () => {
      authCallback?.('SIGNED_OUT', null);
    });

    expect(screen.getByTestId('permissions')).toHaveTextContent('none');
    expect(screen.getByTestId('role')).toHaveTextContent('none');
  });

  it('unsubscribes from auth changes on unmount', async () => {
    const { unmount } = renderProbe();
    await waitFor(() => expect(authClient.auth.onAuthStateChange).toHaveBeenCalled());

    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
