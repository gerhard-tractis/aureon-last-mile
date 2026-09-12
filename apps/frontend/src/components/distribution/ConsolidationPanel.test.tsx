import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ConsolidationPanel, deliveryLabel } from './ConsolidationPanel';
import type { ConsolidationPackage } from '@/hooks/distribution/useConsolidation';
import { todayISOInTimezone } from '@/lib/utils/dateFormat';

function pkg(overrides: Partial<ConsolidationPackage> = {}): ConsolidationPackage {
  return {
    id: 'p1',
    label: 'PKG-001',
    dock_zone_id: 'z1',
    order_id: 'o1',
    delivery_date: '2026-03-19',
    comunaId: 'c1',
    comunaName: 'La Florida',
    orderNumber: 'ORD-48213',
    customerName: 'Camila Fernández',
    ...overrides,
  };
}

// spec-96 fase 4 — `4a` draws Consolidación as a full-width table grouped
// by order, not a card list per package. These tests replace the old
// package-per-row assertions (each order here has its own single package,
// so the release-target assertions still exercise the same "one action per
// unit of work" behaviour the old tests guarded — just one order deep).
describe('ConsolidationPanel', () => {
  it('groups packages by order into a single row per order', () => {
    render(
      <ConsolidationPanel
        packages={[
          pkg({ id: 'p1', order_id: 'o1' }),
          pkg({ id: 'p2', order_id: 'o1' }),
          pkg({ id: 'p3', order_id: 'o2', orderNumber: 'ORD-48241' }),
        ]}
        onRelease={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId('consolidation-order-row')).toHaveLength(2);
  });

  it('renders the order number and recipient/comuna per row', () => {
    render(
      <ConsolidationPanel packages={[pkg({ id: 'p1', order_id: 'o1' })]} onRelease={vi.fn()} />,
    );
    const row = screen.getByTestId('consolidation-order-row');
    expect(within(row).getByText('ORD-48213')).toBeInTheDocument();
    expect(within(row).getByText(/Camila Fernández/)).toBeInTheDocument();
    expect(within(row).getByText(/La Florida/)).toBeInTheDocument();
  });

  it('calls onRelease with every package id of that order when Liberar is clicked', () => {
    const onRelease = vi.fn();
    render(
      <ConsolidationPanel
        packages={[pkg({ id: 'p1', order_id: 'o1' }), pkg({ id: 'p2', order_id: 'o1' })]}
        onRelease={onRelease}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^liberar$/i }));
    expect(onRelease).toHaveBeenCalledWith(['p1', 'p2']);
  });

  it('shows empty state when no packages in consolidation', () => {
    render(<ConsolidationPanel packages={[]} onRelease={vi.fn()} />);
    expect(screen.getByText('Sin paquetes en consolidación')).toBeInTheDocument();
    expect(screen.getByText(/necesiten consolidarse/i)).toBeInTheDocument();
  });

  it('summarises the total package and order count in the header badge', () => {
    render(
      <ConsolidationPanel
        packages={[
          pkg({ id: 'p1', order_id: 'o1' }),
          pkg({ id: 'p2', order_id: 'o1' }),
          pkg({ id: 'p3', order_id: 'o2', orderNumber: 'ORD-48241' }),
        ]}
        onRelease={vi.fn()}
      />,
    );
    expect(screen.getByTestId('consolidation-summary')).toHaveTextContent('3 paq.');
    expect(screen.getByTestId('consolidation-summary')).toHaveTextContent('2 órdenes');
  });

  it('selecting orders and clicking "Liberar seleccionadas" releases the union of their package ids', () => {
    const onRelease = vi.fn();
    render(
      <ConsolidationPanel
        packages={[
          pkg({ id: 'p1', order_id: 'o1' }),
          pkg({ id: 'p2', order_id: 'o2', orderNumber: 'ORD-48241' }),
        ]}
        onRelease={onRelease}
      />,
    );
    const rows = screen.getAllByTestId('consolidation-order-row');
    fireEvent.click(within(rows[0]).getByRole('checkbox'));
    fireEvent.click(within(rows[1]).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /liberar seleccionadas/i }));
    expect(onRelease).toHaveBeenCalledWith(['p1', 'p2']);
  });

  it('does not release an order whose checkbox was never selected', () => {
    const onRelease = vi.fn();
    render(
      <ConsolidationPanel
        packages={[
          pkg({ id: 'p1', order_id: 'o1' }),
          pkg({ id: 'p2', order_id: 'o2', orderNumber: 'ORD-48241' }),
        ]}
        onRelease={onRelease}
      />,
    );
    const rows = screen.getAllByTestId('consolidation-order-row');
    fireEvent.click(within(rows[0]).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /liberar seleccionadas/i }));
    expect(onRelease).toHaveBeenCalledWith(['p1']);
  });

  // Review fix — `date < today → AYER` said AYER for ANY past date, not
  // just yesterday. On a triage queue that reads a week-late order as one
  // day late, false in the reassuring direction. `now` is injectable so
  // this doesn't depend on the real clock.
  describe('ENTREGA — AYER means exactly yesterday, not "any past date"', () => {
    const now = new Date('2026-03-20T12:00:00');

    it('shows AYER for a delivery exactly one day ago', () => {
      render(
        <ConsolidationPanel
          packages={[pkg({ id: 'p1', order_id: 'o1', delivery_date: '2026-03-19' })]}
          onRelease={vi.fn()}
          now={now}
        />,
      );
      expect(screen.getByTestId('consolidation-order-row')).toHaveTextContent('AYER');
    });

    it('shows HOY for a delivery today', () => {
      render(
        <ConsolidationPanel
          packages={[pkg({ id: 'p1', order_id: 'o1', delivery_date: '2026-03-20' })]}
          onRelease={vi.fn()}
          now={now}
        />,
      );
      expect(screen.getByTestId('consolidation-order-row')).toHaveTextContent('HOY');
    });

    it('does NOT say AYER for a delivery 10 days ago — shows the real date instead', () => {
      render(
        <ConsolidationPanel
          packages={[pkg({ id: 'p1', order_id: 'o1', delivery_date: '2026-03-10' })]}
          onRelease={vi.fn()}
          now={now}
        />,
      );
      const row = screen.getByTestId('consolidation-order-row');
      expect(row).not.toHaveTextContent('AYER');
      // Review fix — reuses lib/distribution/relative-date.ts's own
      // "DD MMM" fallback (already used by the pendientes list) instead
      // of a raw ISO date or a hand-rolled format.
      expect(row).toHaveTextContent('10 MAR');
    });

    it('shows the "DD MMM" fallback, not HOY/AYER, for a future delivery', () => {
      render(
        <ConsolidationPanel
          packages={[pkg({ id: 'p1', order_id: 'o1', delivery_date: '2026-03-25' })]}
          onRelease={vi.fn()}
          now={now}
        />,
      );
      const row = screen.getByTestId('consolidation-order-row');
      expect(row).not.toHaveTextContent('AYER');
      expect(row).not.toHaveTextContent('HOY');
      expect(row).toHaveTextContent('25 MAR');
    });
  });

  // Review fix — `deliveryLabel` used `new Date(now)` + `setHours(0,0,0,0)`,
  // midnight in the RUNTIME's zone. `page.tsx` ten lines above correctly
  // uses `todayISOInTimezone`. Next prerenders `'use client'` components
  // server-side with `TZ=UTC`; late evening in Santiago, that server
  // computes tomorrow's date as "today" — an order due today would render
  // AYER in red. Tested directly against the exported function so it does
  // not depend on the test runner's own timezone.
  describe('deliveryLabel — Santiago civil date, not the runtime local date', () => {
    it("treats a delivery matching Santiago's civil today as HOY", () => {
      // 02:30 UTC on the 13th — already the 12th in Santiago (UTC-3/-4).
      const now = new Date('2026-09-13T02:30:00Z');
      const santiagoToday = todayISOInTimezone(now);
      expect(deliveryLabel(santiagoToday, now)).toEqual({ text: 'HOY', tone: 'warning' });
    });

    it("treats a delivery matching Santiago's civil yesterday as AYER, not HOY", () => {
      const now = new Date('2026-09-13T02:30:00Z');
      const santiagoToday = todayISOInTimezone(now);
      const santiagoYesterday = todayISOInTimezone(
        new Date(new Date(santiagoToday + 'T12:00:00Z').getTime() - 24 * 60 * 60 * 1000),
      );
      expect(deliveryLabel(santiagoYesterday, now)).toEqual({ text: 'AYER', tone: 'error' });
    });
  });

  // Review fix — mutating the tone away (e.g. `overdue` → `neutral`) left
  // the suite green: the label text was covered, the tone was not,
  // without resorting to a className assertion. `deliveryLabel` is
  // exported so this is a behaviour assertion on its return value, not
  // appearance. Tone split matches `4a`'s own: AYER is `error` (`:346`),
  // HOY is `warning` (`:354`), a future date is `neutral`.
  describe('deliveryLabel — tone', () => {
    const now = new Date('2026-03-20T12:00:00');

    it('is error for AYER and anything older, warning for HOY, neutral for a future date', () => {
      expect(deliveryLabel('2026-03-19', now).tone).toBe('error'); // AYER
      expect(deliveryLabel('2026-03-20', now).tone).toBe('warning'); // HOY
      expect(deliveryLabel('2026-03-10', now).tone).toBe('error'); // older
      expect(deliveryLabel('2026-03-25', now).tone).toBe('neutral'); // future
    });
  });

  describe('BULTOS column', () => {
    it("renders the order's package count currently held in consolidation", () => {
      render(
        <ConsolidationPanel
          packages={[
            pkg({ id: 'p1', order_id: 'o1' }),
            pkg({ id: 'p2', order_id: 'o1' }),
            pkg({ id: 'p3', order_id: 'o1' }),
          ]}
          onRelease={vi.fn()}
        />,
      );
      expect(screen.getByTestId('consolidation-bultos')).toHaveTextContent('3');
    });
  });

  describe('selection clears after a release', () => {
    it('clears the checkbox after releasing via the per-row Liberar button', () => {
      render(
        <ConsolidationPanel
          packages={[
            pkg({ id: 'p1', order_id: 'o1' }),
            pkg({ id: 'p2', order_id: 'o2', orderNumber: 'ORD-48241' }),
          ]}
          onRelease={vi.fn()}
        />,
      );
      const rows = screen.getAllByTestId('consolidation-order-row');
      const checkbox = within(rows[0]).getByRole('checkbox') as HTMLInputElement;
      fireEvent.click(checkbox);
      expect(checkbox.checked).toBe(true);
      fireEvent.click(within(rows[0]).getByRole('button', { name: /^liberar$/i }));
      expect(checkbox.checked).toBe(false);
    });

    it('a second click on "Liberar seleccionadas" after a release does not fire again with an empty array', () => {
      const onRelease = vi.fn();
      render(
        <ConsolidationPanel
          packages={[
            pkg({ id: 'p1', order_id: 'o1' }),
            pkg({ id: 'p2', order_id: 'o2', orderNumber: 'ORD-48241' }),
          ]}
          onRelease={onRelease}
        />,
      );
      const rows = screen.getAllByTestId('consolidation-order-row');
      fireEvent.click(within(rows[0]).getByRole('checkbox'));
      const releaseSelectedButton = screen.getByRole('button', { name: /liberar seleccionadas/i });
      fireEvent.click(releaseSelectedButton);
      expect(onRelease).toHaveBeenCalledTimes(1);
      // The button disables itself once the selection is empty again —
      // clicking (a no-op on a disabled button) must not fire a second time.
      fireEvent.click(releaseSelectedButton);
      expect(onRelease).toHaveBeenCalledTimes(1);
    });
  });
});
