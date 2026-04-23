import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

// ── mocks ──────────────────────────────────────────────────────────────────────
const mockGetSession = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/server', () => ({
  createSSRClient: vi.fn().mockResolvedValue({
    auth: { getSession: mockGetSession },
  }),
}));

const mockRedirect = vi.hoisted(() =>
  vi.fn().mockImplementation(() => {
    throw new Error('NEXT_REDIRECT');
  }),
);

const mockNotFound = vi.hoisted(() =>
  vi.fn().mockImplementation(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
);

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
  notFound: mockNotFound,
}));

vi.mock('./WismoTestClient', () => ({
  default: ({ operatorId }: { operatorId: string }) => (
    <div data-testid="wismo-test-client" data-operator-id={operatorId} />
  ),
}));

import WismoTestPage from './page';

// ── helpers ────────────────────────────────────────────────────────────────────
function sessionWithRole(role: string) {
  return {
    data: {
      session: {
        user: {
          app_metadata: {
            claims: { role, operator_id: 'op-abc' },
          },
        },
      },
    },
  };
}

// ── tests ──────────────────────────────────────────────────────────────────────
describe('WismoTestPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to /auth/login when no session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    await expect(WismoTestPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(mockRedirect).toHaveBeenCalledWith('/auth/login');
  });

  it('returns 404 when role is not admin or maintainer', async () => {
    mockGetSession.mockResolvedValue(sessionWithRole('operator'));
    await expect(WismoTestPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockNotFound).toHaveBeenCalled();
  });

  it('renders WismoTestClient when role is admin', async () => {
    mockGetSession.mockResolvedValue(sessionWithRole('admin'));
    const element = await WismoTestPage();
    const { getByTestId } = render(element as React.ReactElement);
    expect(getByTestId('wismo-test-client')).toBeInTheDocument();
  });

  it('renders WismoTestClient when role is maintainer', async () => {
    mockGetSession.mockResolvedValue(sessionWithRole('maintainer'));
    const element = await WismoTestPage();
    const { getByTestId } = render(element as React.ReactElement);
    expect(getByTestId('wismo-test-client')).toBeInTheDocument();
  });
});
