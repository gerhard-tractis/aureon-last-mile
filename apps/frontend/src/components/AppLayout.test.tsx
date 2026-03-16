import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// Mock dependencies
vi.mock('next/navigation', () => ({
  usePathname: () => '/app',
  useRouter: () => ({ push: vi.fn() }),
}));

const mockGlobal = {
  user: { email: 'test@example.com' },
  role: 'admin' as string | null,
  permissions: [] as string[],
  operatorId: 'op-test' as string | null,
};

vi.mock('@/lib/context/GlobalContext', () => ({
  useGlobal: () => mockGlobal,
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

describe('AppLayout sidebar branding', () => {
  it('renders default product name when no branding', () => {
    mockBranding.logoUrl = null;
    mockBranding.companyName = null;

    render(<AppLayout><div>content</div></AppLayout>);

    // Product name from env or fallback
    const sidebar = document.querySelector('.border-b');
    expect(sidebar).toBeTruthy();
  });

  it('renders company name when set but no logo', () => {
    mockBranding.logoUrl = null;
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

    // Simulate image error
    fireEvent.error(img);

    // After error, should show text instead
    expect(screen.getByText('Fallback Corp')).toBeTruthy();
  });
});

describe('AppLayout nav items – Capacidad and Auditoría', () => {
  it('shows Capacidad link for admin role', () => {
    mockGlobal.role = 'admin';
    mockBranding.logoUrl = null;
    mockBranding.companyName = null;

    render(<AppLayout><div>content</div></AppLayout>);

    expect(screen.getByRole('link', { name: /capacidad/i })).toBeTruthy();
  });

  it('shows Capacidad link for operations_manager role', () => {
    mockGlobal.role = 'operations_manager';
    mockBranding.logoUrl = null;
    mockBranding.companyName = null;

    render(<AppLayout><div>content</div></AppLayout>);

    expect(screen.getByRole('link', { name: /capacidad/i })).toBeTruthy();
  });

  it('hides Capacidad link for other roles', () => {
    mockGlobal.role = 'driver';
    mockBranding.logoUrl = null;
    mockBranding.companyName = null;

    render(<AppLayout><div>content</div></AppLayout>);

    expect(screen.queryByRole('link', { name: /capacidad/i })).toBeNull();
  });

  it('Capacidad link points to /app/capacity-planning', () => {
    mockGlobal.role = 'admin';
    mockBranding.logoUrl = null;
    mockBranding.companyName = null;

    render(<AppLayout><div>content</div></AppLayout>);

    const link = screen.getByRole('link', { name: /capacidad/i }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/app/capacity-planning');
  });

  it('shows Auditoría link for admin role', () => {
    mockGlobal.role = 'admin';
    mockBranding.logoUrl = null;
    mockBranding.companyName = null;

    render(<AppLayout><div>content</div></AppLayout>);

    expect(screen.getByRole('link', { name: /auditor[ií]a/i })).toBeTruthy();
  });

  it('shows Auditoría link for operations_manager role', () => {
    mockGlobal.role = 'operations_manager';
    mockBranding.logoUrl = null;
    mockBranding.companyName = null;

    render(<AppLayout><div>content</div></AppLayout>);

    expect(screen.getByRole('link', { name: /auditor[ií]a/i })).toBeTruthy();
  });

  it('hides Auditoría link for other roles', () => {
    mockGlobal.role = 'driver';
    mockBranding.logoUrl = null;
    mockBranding.companyName = null;

    render(<AppLayout><div>content</div></AppLayout>);

    expect(screen.queryByRole('link', { name: /auditor[ií]a/i })).toBeNull();
  });

  it('Auditoría link points to /app/audit-logs', () => {
    mockGlobal.role = 'admin';
    mockBranding.logoUrl = null;
    mockBranding.companyName = null;

    render(<AppLayout><div>content</div></AppLayout>);

    const link = screen.getByRole('link', { name: /auditor[ií]a/i }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/app/audit-logs');
  });
});

describe('AppLayout CapacityAlertBell', () => {
  it('renders the bell for admin role', () => {
    mockGlobal.role = 'admin';
    mockBranding.logoUrl = null;
    mockBranding.companyName = null;

    render(<AppLayout><div>content</div></AppLayout>);

    expect(screen.getByRole('button', { name: /alertas de capacidad/i })).toBeTruthy();
  });

  it('renders the bell for operations_manager role', () => {
    mockGlobal.role = 'operations_manager';
    mockBranding.logoUrl = null;
    mockBranding.companyName = null;

    render(<AppLayout><div>content</div></AppLayout>);

    expect(screen.getByRole('button', { name: /alertas de capacidad/i })).toBeTruthy();
  });

  it('does not render the bell for other roles', () => {
    mockGlobal.role = 'driver';
    mockBranding.logoUrl = null;
    mockBranding.companyName = null;

    render(<AppLayout><div>content</div></AppLayout>);

    expect(screen.queryByRole('button', { name: /alertas de capacidad/i })).toBeNull();
  });

  it('passes operatorId to CapacityAlertBell', () => {
    mockGlobal.role = 'admin';
    mockGlobal.operatorId = 'op-test';
    mockBranding.logoUrl = null;
    mockBranding.companyName = null;

    render(<AppLayout><div>content</div></AppLayout>);

    const bell = screen.getByRole('button', { name: /alertas de capacidad/i });
    expect(bell.getAttribute('data-operator-id')).toBe('op-test');
  });
});
