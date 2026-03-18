import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// Mock dependencies
vi.mock('next/navigation', () => ({
  usePathname: () => '/app',
  useRouter: () => ({ push: vi.fn() }),
}));

let mockRole = 'admin';
let mockPermissions: string[] = [];
let mockOperatorId: string | null = 'op-test';

vi.mock('@/lib/context/GlobalContext', () => ({
  useGlobal: () => ({
    user: { email: 'test@example.com' },
    role: mockRole,
    permissions: mockPermissions,
    operatorId: mockOperatorId,
  }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createSPASassClient: () => Promise.resolve({ logout: vi.fn() }),
}));

const mockBranding = {
  logoUrl: null as string | null,
  companyName: null as string | null,
  primaryColor: null,
  secondaryColor: null,
  faviconUrl: null,
  isLoading: false,
};

vi.mock('@/providers/BrandingProvider', () => ({
  useBranding: () => mockBranding,
}));

// Mock CapacityAlertBell to avoid hook dependencies in AppLayout tests
vi.mock('@/components/capacity/CapacityAlertBell', () => ({
  default: ({ operatorId }: { operatorId: string | null }) => (
    <button aria-label="Alertas de capacidad" data-operator-id={operatorId}>
      Bell
    </button>
  ),
}));

import AppLayout from './AppLayout';

beforeEach(() => {
  mockRole = 'admin';
  mockPermissions = [];
  mockOperatorId = 'op-test';
  mockBranding.logoUrl = null;
  mockBranding.companyName = null;
});

describe('AppLayout sidebar branding', () => {
  it('renders default product name when no branding', () => {
    render(<AppLayout><div>content</div></AppLayout>);
    const sidebar = document.querySelector('.border-b');
    expect(sidebar).toBeTruthy();
  });

  it('renders company name when set but no logo', () => {
    mockBranding.companyName = 'Musan Logistics';
    render(<AppLayout><div>content</div></AppLayout>);
    expect(screen.getByText('Musan Logistics')).toBeTruthy();
  });

  it('renders logo image when logoUrl is set', () => {
    mockBranding.logoUrl = 'https://example.com/logo.png';
    mockBranding.companyName = 'Musan Logistics';
    render(<AppLayout><div>content</div></AppLayout>);
    const img = document.querySelector('img[src="https://example.com/logo.png"]') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.alt).toBe('Musan Logistics');
    expect(img.className).toContain('max-h-10');
    expect(img.className).toContain('object-contain');
  });

  it('falls back to text on logo error', () => {
    mockBranding.logoUrl = 'https://example.com/broken.png';
    mockBranding.companyName = 'Fallback Corp';
    render(<AppLayout><div>content</div></AppLayout>);
    const img = document.querySelector('img') as HTMLImageElement;
    expect(img).toBeTruthy();
    fireEvent.error(img);
    expect(screen.getByText('Fallback Corp')).toBeTruthy();
  });
});

describe('AppLayout - Ops Control nav item', () => {
  it('shows Ops Control link for admin role', () => {
    mockRole = 'admin';
    render(<AppLayout><div>content</div></AppLayout>);
    expect(screen.getByText('Ops Control')).toBeTruthy();
  });

  it('shows Ops Control link for operations_manager role', () => {
    mockRole = 'operations_manager';
    render(<AppLayout><div>content</div></AppLayout>);
    expect(screen.getByText('Ops Control')).toBeTruthy();
  });

  it('hides Ops Control link for driver role', () => {
    mockRole = 'driver';
    render(<AppLayout><div>content</div></AppLayout>);
    expect(screen.queryByText('Ops Control')).toBeNull();
  });

  it('hides Ops Control link for viewer role', () => {
    mockRole = 'viewer';
    render(<AppLayout><div>content</div></AppLayout>);
    expect(screen.queryByText('Ops Control')).toBeNull();
  });
});

describe('AppLayout nav items – Capacidad and Auditoría', () => {
  it('shows Capacidad link for admin role', () => {
    mockRole = 'admin';
    render(<AppLayout><div>content</div></AppLayout>);
    expect(screen.getByRole('link', { name: /capacidad/i })).toBeTruthy();
  });

  it('shows Capacidad link for operations_manager role', () => {
    mockRole = 'operations_manager';
    render(<AppLayout><div>content</div></AppLayout>);
    expect(screen.getByRole('link', { name: /capacidad/i })).toBeTruthy();
  });

  it('hides Capacidad link for other roles', () => {
    mockRole = 'driver';
    render(<AppLayout><div>content</div></AppLayout>);
    expect(screen.queryByRole('link', { name: /capacidad/i })).toBeNull();
  });

  it('Capacidad link points to /app/capacity-planning', () => {
    mockRole = 'admin';
    render(<AppLayout><div>content</div></AppLayout>);
    const link = screen.getByRole('link', { name: /capacidad/i }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/app/capacity-planning');
  });

  it('shows Auditoría link for admin role', () => {
    mockRole = 'admin';
    render(<AppLayout><div>content</div></AppLayout>);
    expect(screen.getByRole('link', { name: /auditor[ií]a/i })).toBeTruthy();
  });

  it('shows Auditoría link for operations_manager role', () => {
    mockRole = 'operations_manager';
    render(<AppLayout><div>content</div></AppLayout>);
    expect(screen.getByRole('link', { name: /auditor[ií]a/i })).toBeTruthy();
  });

  it('hides Auditoría link for other roles', () => {
    mockRole = 'driver';
    render(<AppLayout><div>content</div></AppLayout>);
    expect(screen.queryByRole('link', { name: /auditor[ií]a/i })).toBeNull();
  });

  it('Auditoría link points to /app/audit-logs', () => {
    mockRole = 'admin';
    render(<AppLayout><div>content</div></AppLayout>);
    const link = screen.getByRole('link', { name: /auditor[ií]a/i }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/app/audit-logs');
  });
});

describe('AppLayout CapacityAlertBell', () => {
  it('renders the bell for admin role', () => {
    mockRole = 'admin';
    render(<AppLayout><div>content</div></AppLayout>);
    expect(screen.getByRole('button', { name: /alertas de capacidad/i })).toBeTruthy();
  });

  it('renders the bell for operations_manager role', () => {
    mockRole = 'operations_manager';
    render(<AppLayout><div>content</div></AppLayout>);
    expect(screen.getByRole('button', { name: /alertas de capacidad/i })).toBeTruthy();
  });

  it('does not render the bell for other roles', () => {
    mockRole = 'driver';
    render(<AppLayout><div>content</div></AppLayout>);
    expect(screen.queryByRole('button', { name: /alertas de capacidad/i })).toBeNull();
  });

  it('passes operatorId to CapacityAlertBell', () => {
    mockRole = 'admin';
    mockOperatorId = 'op-test';
    render(<AppLayout><div>content</div></AppLayout>);
    const bell = screen.getByRole('button', { name: /alertas de capacidad/i });
    expect(bell.getAttribute('data-operator-id')).toBe('op-test');
  });
});

describe('AppLayout Recepción nav permission gating', () => {
  it('shows Recepción nav item when user has reception permission', () => {
    mockPermissions = ['reception'];
    render(<AppLayout><div>content</div></AppLayout>);
    expect(screen.getByText('Recepción')).toBeTruthy();
    const link = screen.getByText('Recepción').closest('a');
    expect(link).toBeTruthy();
    expect(link?.getAttribute('href')).toBe('/app/reception');
  });

  it('hides Recepción nav item when user lacks reception permission', () => {
    mockPermissions = [];
    render(<AppLayout><div>content</div></AppLayout>);
    expect(screen.queryByText('Recepción')).toBeNull();
  });

  it('shows both Pickup and Recepción when user has both permissions', () => {
    mockPermissions = ['pickup', 'reception'];
    render(<AppLayout><div>content</div></AppLayout>);
    expect(screen.getByText('Pickup')).toBeTruthy();
    expect(screen.getByText('Recepción')).toBeTruthy();
  });
});
