import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

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

vi.mock('next/navigation', () => ({ redirect: mockRedirect }));

vi.mock('@/components/admin/DriverManagementPage', () => ({
  DriverManagementPage: () => <div data-testid="driver-management-page" />,
}));

import AdminDriversPage from './page';

function sessionWithRole(role: string) {
  return {
    data: {
      session: { user: { app_metadata: { claims: { role, operator_id: 'op-1' } } } },
    },
  };
}

describe('AdminDriversPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to /login when there is no session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    await expect(AdminDriversPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(mockRedirect).toHaveBeenCalledWith('/login');
  });

  it('redirects unauthorized roles', async () => {
    mockGetSession.mockResolvedValue(sessionWithRole('pickup_crew'));
    await expect(AdminDriversPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(mockRedirect).toHaveBeenCalledWith('/?error=unauthorized');
  });

  it.each(['admin', 'operations_manager'])('renders DriverManagementPage for role %s', async (role) => {
    mockGetSession.mockResolvedValue(sessionWithRole(role));
    const element = await AdminDriversPage();
    const { getByTestId } = render(element as React.ReactElement);
    expect(getByTestId('driver-management-page')).toBeInTheDocument();
  });
});
