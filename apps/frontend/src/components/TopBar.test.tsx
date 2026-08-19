import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

let mockUser: { email: string } | null = { email: 'driver@example.com' };
const mockLogout = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/context/GlobalContext', () => ({
  useGlobal: () => ({ user: mockUser, role: 'driver', permissions: [], operatorId: null }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createSPASassClient: () => Promise.resolve({ logout: mockLogout }),
}));

vi.mock('@/hooks/useSyncQueue', () => ({
  useSyncQueue: () => ({ status: 'online', queuedCount: 0 }),
}));

vi.mock('@/providers/BrandingProvider', () => ({
  useBranding: () => ({ hasBranding: false, palette: null }),
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ mode: 'light', setMode: vi.fn() }),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/pickup',
}));

import TopBar from './TopBar';

beforeEach(() => {
  mockUser = { email: 'driver@example.com' };
  mockLogout.mockClear();
});

describe('TopBar — mobile account menu (spec-54 gap fix)', () => {
  it('renders a user menu trigger with an accessible name', () => {
    render(<TopBar />);
    const trigger = screen.getByRole('button', { name: /cuenta de driver@example.com/i });
    expect(trigger).toBeTruthy();
  });

  it('sizes the trigger at a 44px touch target', () => {
    render(<TopBar />);
    const trigger = screen.getByRole('button', { name: /cuenta de driver@example.com/i });
    expect(trigger.className).toContain('h-11');
    expect(trigger.className).toContain('w-11');
  });

  it('hides the trigger at lg and up via CSS, not a viewport hook (no hydration mismatch)', () => {
    render(<TopBar />);
    const trigger = screen.getByRole('button', { name: /cuenta de driver@example.com/i });
    expect(trigger.className).toContain('lg:hidden');
  });

  it('opens the menu and shows Cerrar Sesion', async () => {
    const user = userEvent.setup();
    render(<TopBar />);
    await user.click(screen.getByRole('button', { name: /cuenta de driver@example.com/i }));
    expect(screen.getByText('Cerrar Sesion')).toBeTruthy();
  });

  it('logout calls the same supabase client.logout() the sidebar uses', async () => {
    const user = userEvent.setup();
    render(<TopBar />);
    await user.click(screen.getByRole('button', { name: /cuenta de driver@example.com/i }));
    await user.click(screen.getByText('Cerrar Sesion'));
    await vi.waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
  });

  it('offers Perfil and Cambiar Clave links', async () => {
    const user = userEvent.setup();
    render(<TopBar />);
    await user.click(screen.getByRole('button', { name: /cuenta de driver@example.com/i }));
    const profileLink = screen.getByText('Perfil').closest('a');
    expect(profileLink?.getAttribute('href')).toBe('/app/user-settings');
    const passwordLink = screen.getByText('Cambiar Clave').closest('a');
    expect(passwordLink?.getAttribute('href')).toBe('/auth/forgot-password');
  });
});
