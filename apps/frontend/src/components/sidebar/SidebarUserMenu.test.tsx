import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const mockLogout = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/context/GlobalContext', () => ({
  useGlobal: () => ({ user: { email: 'admin@example.com' } }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createSPASassClient: () => Promise.resolve({ logout: mockLogout }),
}));

import { SidebarUserMenu } from './SidebarUserMenu';

beforeEach(() => {
  mockLogout.mockClear();
});

describe('SidebarUserMenu — shared with TopBarUserMenu (spec-54 gap fix)', () => {
  it('shows initials always, and the email only when pinned', () => {
    const { rerender } = render(<SidebarUserMenu pinned={false} />);
    expect(screen.getByText('AD')).toBeTruthy();
    expect(screen.queryByText('admin@example.com')).toBeNull();

    rerender(<SidebarUserMenu pinned />);
    expect(screen.getByText('admin@example.com')).toBeTruthy();
  });

  it('logs out via the same supabase client.logout() used by the topbar menu', async () => {
    const user = userEvent.setup();
    render(<SidebarUserMenu pinned />);
    await user.click(screen.getByRole('button'));
    await user.click(screen.getByText('Cerrar Sesion'));
    await vi.waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
  });
});
