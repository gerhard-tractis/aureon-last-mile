import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The marketing landing page was removed from the product surface: `/` is now
 * a pure router. Anonymous visitors go to the login form, signed-in users go
 * into the app shell, which then resolves their own landing route.
 */

const getUser = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirect(path),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSSRClient: async () => ({ auth: { getUser } }),
}));

async function renderRoot() {
  const { default: RootPage } = await import('./page');
  try {
    await RootPage();
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('REDIRECT:')) throw error;
  }
}

describe('/ (root route)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('sends an anonymous visitor to the login form', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await renderRoot();
    expect(redirect).toHaveBeenCalledWith('/auth/login');
  });

  it('sends a signed-in user into the app', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    await renderRoot();
    expect(redirect).toHaveBeenCalledWith('/app');
  });

  it('renders no marketing content of its own', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await renderRoot();
    // A redirect is the entire body — nothing is returned to render.
    expect(redirect).toHaveBeenCalledOnce();
  });
});
