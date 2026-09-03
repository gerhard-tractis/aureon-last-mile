import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { PreRouteAnden } from '@/lib/types';

const mockReplace = vi.fn();
let mockParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(() => mockParams),
  useRouter: vi.fn(() => ({ replace: mockReplace })),
  usePathname: vi.fn(() => '/app/dispatch'),
}));

import { PreRouteFilters } from './PreRouteFilters';

const ANDENES: PreRouteAnden[] = [
  {
    id: 'a1',
    name: 'Sur Oriente',
    comunas_list: ['La Florida'],
    order_count: 1,
    package_count: 2,
    order_ids: ['o1'],
    has_split_dock_zone_warnings: false,
    comunas: [
      {
        id: 'c1',
        name: 'La Florida',
        order_count: 1,
        package_count: 2,
        orders: [
          {
            id: 'o1',
            order_number: 'ORD-001',
            customer_name: 'Ana Soto',
            delivery_address: 'Av. Siempre Viva 742',
            delivery_window_start: '08:00:00',
            delivery_window_end: '12:00:00',
            package_count: 2,
            has_split_dock_zone: false,
          },
        ],
      },
    ],
  },
];

function lastReplaceUrl(): string {
  const call = mockReplace.mock.calls.at(-1);
  return call ? (call[0] as string) : '';
}

describe('PreRouteFilters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParams = new URLSearchParams();
  });

  it('labels the date input "Fecha de entrega" (S1) — the RPC cohort key, and the only unlabelled control before this fix', () => {
    render(<PreRouteFilters andenes={[]} />);
    const today = new Date().toISOString().slice(0, 10);
    expect(screen.getByLabelText('Fecha de entrega')).toHaveValue(today);
  });

  it('changing date calls router.replace with ?date=', () => {
    render(<PreRouteFilters andenes={[]} />);
    const today = new Date().toISOString().slice(0, 10);
    fireEvent.change(screen.getByLabelText('Fecha de entrega'), { target: { value: '2026-05-01' } });
    expect(lastReplaceUrl()).toContain('date=2026-05-01');
  });

  it('no longer renders the fixed time-band tabs', () => {
    render(<PreRouteFilters andenes={[]} />);
    expect(screen.queryByRole('button', { name: /^Todas$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Mañana$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Tarde$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Noche$/i })).not.toBeInTheDocument();
  });

  it('renders a free ventana time range that maps to window_start/window_end', () => {
    render(<PreRouteFilters andenes={[]} />);
    fireEvent.change(screen.getByLabelText(/desde/i), { target: { value: '08:00' } });
    expect(lastReplaceUrl()).toContain('window_start=08%3A00');

    fireEvent.change(screen.getByLabelText(/hasta/i), { target: { value: '12:00' } });
    expect(lastReplaceUrl()).toContain('window_end=12%3A00');
  });

  it('shows the unfiltered totals chip when no client-side filter is active', () => {
    render(
      <PreRouteFilters
        andenes={[]}
        totals={{ order_count: 12, package_count: 20, anden_count: 3, split_dock_zone_order_count: 0 }}
      />,
    );
    expect(screen.getByText(/12 órdenes/)).toBeInTheDocument();
    expect(screen.queryByText(/Mostrando/)).not.toBeInTheDocument();
  });

  it('shows "Mostrando X de Y" against filteredTotals once a filter is active (I4)', () => {
    mockParams = new URLSearchParams('comunas=c1');
    render(
      <PreRouteFilters
        andenes={[]}
        totals={{ order_count: 12, package_count: 20, anden_count: 3, split_dock_zone_order_count: 0 }}
        filteredTotals={{ order_count: 3, package_count: 5, anden_count: 1, split_dock_zone_order_count: 0 }}
      />,
    );
    expect(screen.getByText('Mostrando 3 de 12 órdenes · 5 bultos · 1 andenes')).toBeInTheDocument();
  });

  it('offers comuna, andén and cliente multi-select filters built from andenes', () => {
    render(<PreRouteFilters andenes={ANDENES} />);
    expect(screen.getByRole('button', { name: /comuna/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /andén/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cliente/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /comuna/i }));
    expect(screen.getByText('La Florida')).toBeInTheDocument();
  });

  it('selecting a comuna option updates ?comunas=', () => {
    render(<PreRouteFilters andenes={ANDENES} />);
    fireEvent.click(screen.getByRole('button', { name: /comuna/i }));
    fireEvent.click(screen.getByText('La Florida'));
    expect(lastReplaceUrl()).toContain('comunas=c1');
  });

  it('toggling "Sólo con problemas" updates ?problems=1', () => {
    render(<PreRouteFilters andenes={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /sólo con problemas/i }));
    expect(lastReplaceUrl()).toContain('problems=1');
  });

  it('does not query for SKU search', () => {
    render(<PreRouteFilters andenes={[]} />);
    expect(screen.queryByPlaceholderText(/sku/i)).not.toBeInTheDocument();
  });

  describe('búsqueda (I3: debounced, locally-controlled input)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('updates the input immediately, before any debounce fires', () => {
      render(<PreRouteFilters andenes={[]} />);
      const input = screen.getByPlaceholderText(/orden o dirección/i);
      fireEvent.change(input, { target: { value: 'ORD-002' } });
      expect(input).toHaveValue('ORD-002');
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('does not write to the URL on every keystroke', () => {
      render(<PreRouteFilters andenes={[]} />);
      const input = screen.getByPlaceholderText(/orden o dirección/i);
      fireEvent.change(input, { target: { value: 'O' } });
      fireEvent.change(input, { target: { value: 'OR' } });
      fireEvent.change(input, { target: { value: 'ORD' } });
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('commits ?q= once, ~250ms after typing settles', () => {
      render(<PreRouteFilters andenes={[]} />);
      const input = screen.getByPlaceholderText(/orden o dirección/i);
      fireEvent.change(input, { target: { value: 'O' } });
      act(() => {
        vi.advanceTimersByTime(100);
      });
      fireEvent.change(input, { target: { value: 'ORD-002' } }); // resets the debounce
      act(() => {
        vi.advanceTimersByTime(249);
      });
      expect(mockReplace).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(lastReplaceUrl()).toContain('q=ORD-002');
    });

    it('removes ?q= entirely when búsqueda is cleared', () => {
      mockParams = new URLSearchParams('q=ORD-002');
      render(<PreRouteFilters andenes={[]} />);
      const input = screen.getByPlaceholderText(/orden o dirección/i);
      fireEvent.change(input, { target: { value: '' } });
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(lastReplaceUrl()).not.toContain('q=');
    });
  });

  it('round-trips date/tab/comuna params through a búsqueda commit, none dropped (M11)', () => {
    vi.useFakeTimers();
    mockParams = new URLSearchParams('date=2026-05-01&tab=pre-ruta&comunas=c1');
    render(<PreRouteFilters andenes={[]} />);
    fireEvent.change(screen.getByPlaceholderText(/orden o dirección/i), { target: { value: 'ORD-002' } });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    const url = lastReplaceUrl();
    expect(url).toContain('date=2026-05-01');
    expect(url).toContain('tab=pre-ruta');
    expect(url).toContain('comunas=c1');
    expect(url).toContain('q=ORD-002');
    vi.useRealTimers();
  });
});
