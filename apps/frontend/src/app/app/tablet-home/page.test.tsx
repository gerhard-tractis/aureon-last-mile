import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/app/tablet-home',
}));

let mockPermissions: string[] = [];

vi.mock('@/lib/context/GlobalContext', () => ({
  useGlobal: () => ({
    user: { email: 'driver@test.com' },
    role: 'pickup_crew',
    permissions: mockPermissions,
    operatorId: 'op-1',
    loading: false,
  }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createSPASassClient: () => Promise.resolve({ logout: vi.fn() }),
}));

import TabletHomePage from './page';

beforeEach(() => {
  mockPermissions = [];
});

describe('TabletHomePage', () => {
  it('shows only permitted workflow cards', () => {
    mockPermissions = ['pickup', 'reception'];
    render(<TabletHomePage />);
    expect(screen.getByText('Pickup')).toBeTruthy();
    expect(screen.getByText('Recepción')).toBeTruthy();
    expect(screen.queryByText('Distribución')).toBeNull();
    expect(screen.queryByText('Despacho')).toBeNull();
  });

  it('shows all four cards when user has all permissions', () => {
    mockPermissions = ['pickup', 'reception', 'distribution', 'dispatch'];
    render(<TabletHomePage />);
    expect(screen.getByText('Pickup')).toBeTruthy();
    expect(screen.getByText('Recepción')).toBeTruthy();
    expect(screen.getByText('Distribución')).toBeTruthy();
    expect(screen.getByText('Despacho')).toBeTruthy();
  });

  it('shows no cards when user has no permissions', () => {
    mockPermissions = [];
    render(<TabletHomePage />);
    expect(screen.queryByText('Pickup')).toBeNull();
  });

  it('shows user email', () => {
    mockPermissions = ['pickup'];
    render(<TabletHomePage />);
    expect(screen.getByText('driver@test.com')).toBeTruthy();
  });

  it('shows Cerrar sesión button', () => {
    render(<TabletHomePage />);
    expect(screen.getByText('Cerrar sesión')).toBeTruthy();
  });

  it('pickup card links to /app/pickup', () => {
    mockPermissions = ['pickup'];
    render(<TabletHomePage />);
    const link = screen.getByText('Pickup').closest('a');
    expect(link?.getAttribute('href')).toBe('/app/pickup');
  });
});
