import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

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
  hasBranding: false,
  palette: null as { brand_primary: string } | null,
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

vi.mock('@/components/capacity/CapacityAlertBell', () => ({
  default: ({ operatorId }: { operatorId: string | null }) => (
    <button aria-label="Alertas de capacidad" data-operator-id={operatorId}>
      Bell
    </button>
  ),
}));

vi.mock('@/components/inspector/InspectorSearchPalette', () => ({
  InspectorSearchPalette: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="inspector-palette">Palette</div> : null,
}));

vi.mock('@/components/inspector/OrderInspector', () => ({
  OrderInspector: ({ orderId }: { orderId: string | null }) =>
    orderId ? <div data-testid="order-inspector">Inspector</div> : null,
}));

vi.mock('@/components/tablet/TabletTopBar', () => ({
  default: () => <nav data-testid="tablet-top-bar">TabletTopBar</nav>,
}));

let mockIsTablet = false;
vi.mock('@/hooks/useViewport', () => ({
  useViewport: () => ({ isMobile: false, isTablet: mockIsTablet, isDesktop: !mockIsTablet }),
}));

let mockPathname = '/app';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: vi.fn() }),
}));

// Counters come from a TanStack Query hook; the layout tests have no
// QueryClientProvider and no Supabase, so the mapped result is stubbed here.
// The mapping itself is covered in useNavCounts.test.ts.
const mockNavCounts = {
  pickup: 12 as number | null,
  reception: 4 as number | null,
  distribution: 318 as number | null,
  dispatch: 27 as number | null,
};
vi.mock('@/hooks/useNavCounts', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useNavCounts')>(
    '@/hooks/useNavCounts',
  );
  return { ...actual, useNavCounts: () => mockNavCounts };
});

import AppLayout from './AppLayout';
import { ModuleKey } from '@/lib/modules/registry';

const ALL_MODULES: ModuleKey[] = [
  ModuleKey.OPS_CONTROL,
  ModuleKey.PICKUP,
  ModuleKey.RECEPTION,
  ModuleKey.DISTRIBUTION,
  ModuleKey.DISPATCH,
  ModuleKey.CONVERSATIONS,
];

beforeEach(() => {
  mockRole = 'admin';
  mockPermissions = [];
  mockOperatorId = 'op-test';
  mockBranding.logoUrl = null;
  mockBranding.companyName = null;
  mockIsTablet = false;
  mockPathname = '/app';
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
    render(<AppLayout enabledModules={[ModuleKey.OPS_CONTROL]}><div>content</div></AppLayout>);
    expect(screen.getByText('Torre de control')).toBeTruthy();
  });

  it('shows Ops Control link for operations_manager role', () => {
    mockRole = 'operations_manager';
    render(<AppLayout enabledModules={[ModuleKey.OPS_CONTROL]}><div>content</div></AppLayout>);
    expect(screen.getByText('Torre de control')).toBeTruthy();
  });

  it('hides Ops Control link for driver role', () => {
    mockRole = 'driver';
    render(<AppLayout enabledModules={[ModuleKey.OPS_CONTROL]}><div>content</div></AppLayout>);
    expect(screen.queryByText('Torre de control')).toBeNull();
  });

  it('hides Ops Control link for viewer role', () => {
    mockRole = 'viewer';
    render(<AppLayout enabledModules={[ModuleKey.OPS_CONTROL]}><div>content</div></AppLayout>);
    expect(screen.queryByText('Torre de control')).toBeNull();
  });

  it('hides Ops Control link for admin when ops_control module is disabled', () => {
    mockRole = 'admin';
    render(<AppLayout enabledModules={[]}><div>content</div></AppLayout>);
    expect(screen.queryByText('Torre de control')).toBeNull();
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
    render(<AppLayout enabledModules={ALL_MODULES}><div>content</div></AppLayout>);
    expect(screen.getByText('Recepción')).toBeTruthy();
    const link = screen.getByText('Recepción').closest('a');
    expect(link).toBeTruthy();
    expect(link?.getAttribute('href')).toBe('/app/reception');
  });

  it('hides Recepción nav item when user lacks reception permission', () => {
    mockPermissions = [];
    render(<AppLayout enabledModules={ALL_MODULES}><div>content</div></AppLayout>);
    expect(screen.queryByText('Recepción')).toBeNull();
  });

  it('shows both Recogida and Recepción when user has both permissions', () => {
    mockPermissions = ['pickup', 'reception'];
    render(<AppLayout enabledModules={ALL_MODULES}><div>content</div></AppLayout>);
    expect(screen.getByText('Recogida')).toBeTruthy();
    expect(screen.getByText('Recepción')).toBeTruthy();
  });
});

describe('AppLayout Distribución nav permission gating', () => {
  it('shows Distribución link for users with distribution permission', () => {
    mockPermissions = ['distribution'];
    render(<AppLayout enabledModules={ALL_MODULES}><div>content</div></AppLayout>);
    expect(screen.getByText('Distribución')).toBeTruthy();
    const link = screen.getByText('Distribución').closest('a');
    expect(link).toBeTruthy();
    expect(link?.getAttribute('href')).toBe('/app/distribution');
  });

  it('hides Distribución link for users without distribution permission', () => {
    mockPermissions = ['pickup'];
    render(<AppLayout enabledModules={ALL_MODULES}><div>content</div></AppLayout>);
    expect(screen.queryByText('Distribución')).toBeNull();
  });

  it('shows Distribución alongside Recepción when user has both permissions', () => {
    mockPermissions = ['reception', 'distribution'];
    render(<AppLayout enabledModules={ALL_MODULES}><div>content</div></AppLayout>);
    expect(screen.getByText('Recepción')).toBeTruthy();
    expect(screen.getByText('Distribución')).toBeTruthy();
  });
});

describe('AppLayout module activation gating (spec-46)', () => {
  it('hides all module nav items when enabledModules is empty (only platform items remain)', () => {
    mockRole = 'admin';
    mockPermissions = ['pickup', 'reception', 'distribution', 'dispatch', 'customer_service'];
    render(<AppLayout enabledModules={[]}><div>content</div></AppLayout>);
    expect(screen.queryByText('Torre de control')).toBeNull();
    expect(screen.queryByText('Recogida')).toBeNull();
    expect(screen.queryByText('Recepción')).toBeNull();
    expect(screen.queryByText('Distribución')).toBeNull();
    expect(screen.queryByText('Despacho')).toBeNull();
    expect(screen.queryByText('Conversaciones')).toBeNull();
    // Platform items remain
    expect(screen.getByText('Dashboard ejecutivo')).toBeTruthy();
    expect(screen.getByRole('link', { name: /capacidad/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /auditor[ií]a/i })).toBeTruthy();
  });

  it('shows only enabled modules that user also has RBAC for (Recogida + Despacho)', () => {
    mockRole = 'driver';
    mockPermissions = ['pickup', 'dispatch'];
    render(<AppLayout enabledModules={[ModuleKey.PICKUP, ModuleKey.DISPATCH]}><div>content</div></AppLayout>);
    expect(screen.getByText('Recogida')).toBeTruthy();
    expect(screen.getByText('Despacho')).toBeTruthy();
    expect(screen.queryByText('Recepción')).toBeNull();
    expect(screen.queryByText('Distribución')).toBeNull();
  });

  it('hides a module the operator has enabled but the user lacks RBAC for', () => {
    mockRole = 'driver';
    mockPermissions = ['pickup'];
    render(<AppLayout enabledModules={[ModuleKey.PICKUP, ModuleKey.RECEPTION]}><div>content</div></AppLayout>);
    expect(screen.getByText('Recogida')).toBeTruthy();
    expect(screen.queryByText('Recepción')).toBeNull();
  });

  it('hides a module the user has RBAC for but the operator has not enabled', () => {
    mockRole = 'driver';
    mockPermissions = ['pickup', 'reception'];
    render(<AppLayout enabledModules={[ModuleKey.PICKUP]}><div>content</div></AppLayout>);
    expect(screen.getByText('Recogida')).toBeTruthy();
    expect(screen.queryByText('Recepción')).toBeNull();
  });
});

describe('AppLayout sidebar rail', () => {
  it('renders sidebar in icon-rail mode by default (unpinned)', () => {
    localStorage.clear();
    render(<AppLayout><div>content</div></AppLayout>);
    const sidebar = document.querySelector('[data-sidebar]');
    expect(sidebar).toBeTruthy();
    expect(sidebar?.getAttribute('data-pinned')).toBe('false');
    expect(sidebar?.className).toContain('w-14');
  });

  it('renders pin toggle button', () => {
    localStorage.clear();
    render(<AppLayout><div>content</div></AppLayout>);
    expect(document.querySelector('[data-pin-toggle]')).toBeTruthy();
  });

  it('renders mobile hamburger button on desktop', () => {
    mockIsTablet = false;
    render(<AppLayout><div>content</div></AppLayout>);
    expect(screen.getByRole('button', { name: 'Abrir barra lateral' })).toBeTruthy();
  });
});

describe('AppLayout — unified chrome (no tablet override)', () => {
  it('renders hamburger menu on tablet viewport (sidebar accessible to everyone)', () => {
    mockIsTablet = true;
    render(<AppLayout><div>content</div></AppLayout>);
    expect(screen.getByRole('button', { name: 'Abrir barra lateral' })).toBeTruthy();
  });

  it('renders CapacityAlertBell on tablet viewport for admin', () => {
    mockIsTablet = true;
    mockRole = 'admin';
    render(<AppLayout><div>content</div></AppLayout>);
    expect(screen.getByRole('button', { name: /alertas de capacidad/i })).toBeTruthy();
  });
});

describe('AppLayout — Order Inspector trigger', () => {
  it('renders inspector trigger button for admin', () => {
    mockRole = 'admin';
    render(<AppLayout><div>content</div></AppLayout>);
    expect(screen.getByRole('button', { name: /buscar orden/i })).toBeTruthy();
  });

  it('renders inspector trigger for operations_manager', () => {
    mockRole = 'operations_manager';
    render(<AppLayout><div>content</div></AppLayout>);
    expect(screen.getByRole('button', { name: /buscar orden/i })).toBeTruthy();
  });

  it('does not render inspector trigger for driver role', () => {
    mockRole = 'driver';
    render(<AppLayout><div>content</div></AppLayout>);
    expect(screen.queryByRole('button', { name: /buscar orden/i })).toBeNull();
  });

  it('opens palette when trigger is clicked', () => {
    mockRole = 'admin';
    render(<AppLayout><div>content</div></AppLayout>);
    expect(screen.queryByTestId('inspector-palette')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /buscar orden/i }));
    expect(screen.getByTestId('inspector-palette')).toBeTruthy();
  });
});

describe('AppLayout — grouped navigation (spec-54)', () => {
  it('renders both section headings when the sidebar is pinned', () => {
    localStorage.setItem('aureon-sidebar-pinned', 'true');
    mockRole = 'admin';
    mockPermissions = ['pickup'];
    render(<AppLayout enabledModules={ALL_MODULES}><div>content</div></AppLayout>);
    expect(screen.getByText('OPERACIÓN')).toBeTruthy();
    expect(screen.getByText('GESTIÓN')).toBeTruthy();
    localStorage.clear();
  });

  it('hides section headings in the collapsed icon rail', () => {
    // A tracked-out label has nowhere to go in a 56px column.
    localStorage.clear();
    mockRole = 'admin';
    render(<AppLayout enabledModules={ALL_MODULES}><div>content</div></AppLayout>);
    expect(screen.queryByText('OPERACIÓN')).toBeNull();
  });

  it('drops a section whose items are all hidden', () => {
    localStorage.setItem('aureon-sidebar-pinned', 'true');
    mockRole = 'driver';
    mockPermissions = [];
    render(<AppLayout enabledModules={[]}><div>content</div></AppLayout>);
    expect(screen.queryByText('OPERACIÓN')).toBeNull();
    expect(screen.getByText('GESTIÓN')).toBeTruthy();
    localStorage.clear();
  });
});

describe('AppLayout — queue counters (spec-54)', () => {
  beforeEach(() => {
    localStorage.setItem('aureon-sidebar-pinned', 'true');
    mockRole = 'admin';
    mockPermissions = ['pickup', 'reception', 'distribution', 'dispatch'];
    mockNavCounts.pickup = 12;
    mockNavCounts.distribution = 318;
  });

  it('renders a counter on each operation item', () => {
    render(<AppLayout enabledModules={ALL_MODULES}><div>content</div></AppLayout>);
    expect(screen.getByTestId('nav-count-/app/pickup').textContent).toBe('12');
    expect(screen.getByTestId('nav-count-/app/distribution').textContent).toBe('318');
  });

  it('gives the tower no counter — it is the overview, not a queue', () => {
    render(<AppLayout enabledModules={ALL_MODULES}><div>content</div></AppLayout>);
    expect(screen.queryByTestId('nav-count-/app/operations-control')).toBeNull();
  });

  it('turns a counter warning once it crosses the module threshold', () => {
    render(<AppLayout enabledModules={ALL_MODULES}><div>content</div></AppLayout>);
    // 318 >= 250 for distribution, 12 < 50 for pickup.
    expect(screen.getByTestId('nav-count-/app/distribution').className).toContain(
      'bg-status-warning-bg',
    );
    expect(screen.getByTestId('nav-count-/app/pickup').className).toContain('bg-sidebar-raised');
  });

  it('renders no counter while the count is still unknown', () => {
    mockNavCounts.pickup = null;
    render(<AppLayout enabledModules={ALL_MODULES}><div>content</div></AppLayout>);
    expect(screen.queryByTestId('nav-count-/app/pickup')).toBeNull();
  });
});

describe('AppLayout — topbar (spec-54)', () => {
  it('renders the breadcrumb for the current route', () => {
    mockPathname = '/app/operations-control';
    mockRole = 'admin';
    render(<AppLayout enabledModules={ALL_MODULES}><div>content</div></AppLayout>);
    const crumb = screen.getByRole('navigation', { name: 'Ruta' });
    expect(crumb.textContent).toContain('Operación');
    expect(crumb.textContent).toContain('Torre de control');
  });

  it('exposes the theme toggle at every viewport, including for a driver', () => {
    // Decision on this spec: mobile operators pick their own theme — a
    // warehouse and a sunlit street happen on the same shift.
    mockRole = 'driver';
    render(<AppLayout><div>content</div></AppLayout>);
    expect(screen.getByRole('group', { name: 'Tema' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tema oscuro' })).toBeTruthy();
  });

  it('does not expose search or alerts to a driver', () => {
    mockRole = 'driver';
    render(<AppLayout><div>content</div></AppLayout>);
    expect(screen.queryByRole('button', { name: /buscar orden/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /alertas de capacidad/i })).toBeNull();
  });

  it('opens the palette from the / shortcut', () => {
    mockRole = 'admin';
    render(<AppLayout><div>content</div></AppLayout>);
    expect(screen.queryByTestId('inspector-palette')).toBeNull();
    fireEvent.keyDown(document, { key: '/' });
    expect(screen.getByTestId('inspector-palette')).toBeTruthy();
  });
});
