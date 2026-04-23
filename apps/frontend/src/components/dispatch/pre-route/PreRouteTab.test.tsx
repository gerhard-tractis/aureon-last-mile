import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PreRouteSnapshot } from '@/lib/types';

const mockSnapshotResult = {
  snapshot: null as PreRouteSnapshot | null,
  isLoading: false,
  isError: false,
  fetchStatus: 'idle',
  isSuccess: false,
};

vi.mock('@/hooks/dispatch/pre-route/usePreRouteSnapshot', () => ({
  usePreRouteSnapshot: vi.fn(() => mockSnapshotResult),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: vi.fn(() => ({ operatorId: 'op-test', role: 'admin', permissions: [] })),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useRouter: vi.fn(() => ({ replace: vi.fn() })),
  usePathname: vi.fn(() => '/app/dispatch'),
}));

// Stub route creation — Chunk 5 wires the real mutation
const mockOnCreateRoute = vi.fn();

import { PreRouteTab } from './PreRouteTab';

const MOCK_SNAPSHOT: PreRouteSnapshot = {
  generated_at: '2026-04-23T12:00:00Z',
  totals: { order_count: 2, package_count: 3, anden_count: 1, split_dock_zone_order_count: 0 },
  andenes: [
    {
      id: 'zone-1',
      name: 'Andén Norte',
      comunas_list: ['Santiago'],
      order_count: 2,
      package_count: 3,
      comunas: [],
      order_ids: ['ord-1', 'ord-2'],
      has_split_dock_zone_warnings: false,
    },
  ],
  unmapped_comunas: [],
};

describe('PreRouteTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSnapshotResult.snapshot = null;
    mockSnapshotResult.isLoading = false;
  });

  it('shows loading state', () => {
    mockSnapshotResult.isLoading = true;
    render(<PreRouteTab onCreateRoute={mockOnCreateRoute} />);
    // Some loading indicator present
    expect(document.body.textContent).toMatch(/cargando|loading/i);
  });

  it('shows empty state when no orders', () => {
    mockSnapshotResult.snapshot = {
      ...MOCK_SNAPSHOT,
      totals: { order_count: 0, package_count: 0, anden_count: 0, split_dock_zone_order_count: 0 },
      andenes: [],
    };
    render(<PreRouteTab onCreateRoute={mockOnCreateRoute} />);
    expect(screen.getByText(/No hay órdenes/i)).toBeInTheDocument();
  });

  it('renders andén cards from snapshot', () => {
    mockSnapshotResult.snapshot = MOCK_SNAPSHOT;
    render(<PreRouteTab onCreateRoute={mockOnCreateRoute} />);
    expect(screen.getByText('Andén Norte')).toBeInTheDocument();
  });

  it('clicking Crear ruta on a card calls onCreateRoute with correct ids', () => {
    mockSnapshotResult.snapshot = MOCK_SNAPSHOT;
    render(<PreRouteTab onCreateRoute={mockOnCreateRoute} />);
    fireEvent.click(screen.getByRole('button', { name: /Crear ruta/ }));
    expect(mockOnCreateRoute).toHaveBeenCalledWith(['ord-1', 'ord-2']);
  });

  it('shows select-all checkbox when ≥2 andenes', () => {
    mockSnapshotResult.snapshot = {
      ...MOCK_SNAPSHOT,
      andenes: [
        { ...MOCK_SNAPSHOT.andenes[0] },
        {
          id: 'zone-2', name: 'Andén Sur', comunas_list: [], order_count: 1,
          package_count: 1, comunas: [], order_ids: ['ord-3'], has_split_dock_zone_warnings: false,
        },
      ],
    };
    render(<PreRouteTab onCreateRoute={mockOnCreateRoute} />);
    // Master select-all checkbox should be present
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThanOrEqual(3); // master + 2 card checkboxes
  });

  it('does NOT show select-all checkbox when only 1 andén', () => {
    mockSnapshotResult.snapshot = MOCK_SNAPSHOT; // only 1 andén
    render(<PreRouteTab onCreateRoute={mockOnCreateRoute} />);
    // Only one checkbox: the andén card's own checkbox
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  });

  it('shows selection bar when an andén checkbox is selected', () => {
    mockSnapshotResult.snapshot = MOCK_SNAPSHOT;
    render(<PreRouteTab onCreateRoute={mockOnCreateRoute} />);
    // Selection bar hidden initially
    expect(screen.queryByRole('button', { name: /Crear ruta con selección/i })).not.toBeInTheDocument();

    // Check the andén's checkbox
    const [checkbox] = screen.getAllByRole('checkbox');
    fireEvent.click(checkbox);

    expect(screen.getByRole('button', { name: /Crear ruta con selección/i })).toBeInTheDocument();
  });

  it('clicking selection bar button calls onCreateRoute with all selected order ids', () => {
    mockSnapshotResult.snapshot = MOCK_SNAPSHOT;
    render(<PreRouteTab onCreateRoute={mockOnCreateRoute} />);

    const [checkbox] = screen.getAllByRole('checkbox');
    fireEvent.click(checkbox);

    fireEvent.click(screen.getByRole('button', { name: /Crear ruta con selección/i }));
    expect(mockOnCreateRoute).toHaveBeenCalledWith(['ord-1', 'ord-2']);
  });

  it('Limpiar button clears the selection and hides the selection bar', () => {
    mockSnapshotResult.snapshot = MOCK_SNAPSHOT;
    render(<PreRouteTab onCreateRoute={mockOnCreateRoute} />);

    const [checkbox] = screen.getAllByRole('checkbox');
    fireEvent.click(checkbox);
    expect(screen.getByRole('button', { name: /Limpiar/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Limpiar/i }));
    expect(screen.queryByRole('button', { name: /Crear ruta con selección/i })).not.toBeInTheDocument();
  });
});
