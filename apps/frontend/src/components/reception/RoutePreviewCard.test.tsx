import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockRpc = vi.fn();
const mockFrom = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ rpc: mockRpc, from: mockFrom }),
}));

import { RoutePreviewCard } from './RoutePreviewCard';

const base = {
  id: 'r1',
  code: 'PR-2026-0001',
  status: 'in_progress',
  started_at: '2026-06-25T06:00:00Z',
  driver_name: 'Ana Ruiz',
  vehicle_plate: 'AAA-111',
  manifest_count: 2,
  scanned_count: 7,
};

describe('RoutePreviewCard', () => {
  it('renders code, driver, plate, cargas and scanned packages', () => {
    render(<RoutePreviewCard route={base} />);
    expect(screen.getByText('PR-2026-0001')).toBeInTheDocument();
    expect(screen.getByText(/Ana Ruiz/)).toBeInTheDocument();
    expect(screen.getByText(/AAA-111/)).toBeInTheDocument();
    expect(screen.getByText(/2 cargas/)).toBeInTheDocument();
    expect(screen.getByText(/7 paquetes escaneados/)).toBeInTheDocument();
  });

  it('renders without opening a reception session — no RPC, no query', () => {
    render(<RoutePreviewCard route={base} />);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('marks the view as read-only', () => {
    render(<RoutePreviewCard route={base} />);
    expect(screen.getByText(/en ruta|solo lectura/i)).toBeInTheDocument();
  });

  it('uses the singular form for one carga and copes with missing driver/plate', () => {
    render(
      <RoutePreviewCard
        route={{ ...base, manifest_count: 1, driver_name: null, vehicle_plate: null }}
      />,
    );
    expect(screen.getByText(/1 carga(?!s)/)).toBeInTheDocument();
    expect(screen.getByText(/Sin patente/)).toBeInTheDocument();
  });

  it('renders an action slot when given one', () => {
    render(
      <RoutePreviewCard route={base}>
        <button>Recibir sin QR</button>
      </RoutePreviewCard>,
    );
    expect(screen.getByRole('button', { name: 'Recibir sin QR' })).toBeInTheDocument();
  });
});
