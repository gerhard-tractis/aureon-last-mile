import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PackageRow } from './PackageRow';

const pkg = {
  dispatch_id: 'd1', order_id: 'o1', order_number: 'ORD-4821',
  contact_name: 'Mario González', contact_address: 'Providencia 123',
  contact_phone: null, status: 'pending' as const, stage: 'staged' as const,
  // spec-74 phase 4: default to a single-bulto order, already loaded — the
  // shape most existing (pre-phase-4) fixtures implicitly assumed.
  boxesTotal: 1, boxesLoaded: 1,
};

describe('PackageRow', () => {
  it('renders order number and client name', () => {
    render(<PackageRow index={1} pkg={pkg} onRemove={vi.fn()} />);
    expect(screen.getByText('ORD-4821')).toBeInTheDocument();
    expect(screen.getByText('Mario González')).toBeInTheDocument();
  });

  it('calls onRemove with dispatch_id when remove button clicked', () => {
    const onRemove = vi.fn();
    render(<PackageRow index={1} pkg={pkg} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: /eliminar/i }));
    expect(onRemove).toHaveBeenCalledWith('d1');
  });

  /**
   * spec-70 decision 4: the plan/load gap must be visible during loading, not
   * discovered only at the seal refusal.
   */
  it('marks a row still at stage=planned as not yet staged', () => {
    render(<PackageRow index={1} pkg={{ ...pkg, stage: 'planned', boxesTotal: 1, boxesLoaded: 0 }} onRemove={vi.fn()} />);
    expect(screen.getByText(/sin estibar/i)).toBeInTheDocument();
  });

  it('does not show the unstaged marker for a staged row', () => {
    render(<PackageRow index={1} pkg={pkg} onRemove={vi.fn()} />);
    expect(screen.queryByText(/sin estibar/i)).not.toBeInTheDocument();
  });

  /**
   * spec-74 phase 3 established that a partially_staged order (some bultos
   * loaded, some not) still means the row is not safe to seal. Phase 4
   * gives it its own message instead of reusing "Sin estibar" — a
   * fully-unstaged order (0 of N loaded) and a half-loaded one are
   * different operational facts, per spec-74 Decision 2, and a supervisor
   * has to be able to tell them apart at a glance.
   */
  it('marks a row at stage=partially_staged as not yet staged, with a distinct per-bulto message', () => {
    render(
      <PackageRow
        index={1}
        pkg={{ ...pkg, stage: 'partially_staged', boxesTotal: 3, boxesLoaded: 1 }}
        onRemove={vi.fn()}
      />,
    );
    // Not the same copy as the fully-unstaged case.
    expect(screen.queryByText(/^sin estibar$/i)).not.toBeInTheDocument();
    // spec-74 phase 4 review item 7: name the unit, matching every sibling
    // screen ("N bultos").
    expect(screen.getByText(/1 de 3 bultos estibados/i)).toBeInTheDocument();
  });

  it('still marks the border/warning state for a partially_staged row (not safe to seal)', () => {
    const { container } = render(
      <PackageRow
        index={1}
        pkg={{ ...pkg, stage: 'partially_staged', boxesTotal: 2, boxesLoaded: 1 }}
        onRemove={vi.fn()}
      />,
    );
    expect(container.querySelector('.border-status-warning')).toBeInTheDocument();
  });

  /**
   * spec-74 phase 4 review item 1 (BLOCKER). A 3-bulto order adopted via
   * the route-level scan with one box scanned used to render identically to
   * a fully staged row — no warning border, no copy — while seal-route.ts
   * refuses it, because an `adopted` row's `stage` is never rewritten as
   * its packages load.
   */
  it('marks an adopted row with an outstanding box as not yet staged, with per-bulto copy', () => {
    render(
      <PackageRow
        index={1}
        pkg={{ ...pkg, stage: 'adopted', boxesTotal: 3, boxesLoaded: 1 }}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText(/1 de 3 bultos estibados/i)).toBeInTheDocument();
  });

  it('marks the warning border on an outstanding adopted row', () => {
    const { container } = render(
      <PackageRow
        index={1}
        pkg={{ ...pkg, stage: 'adopted', boxesTotal: 3, boxesLoaded: 1 }}
        onRemove={vi.fn()}
      />,
    );
    expect(container.querySelector('.border-status-warning')).toBeInTheDocument();
  });

  it('shows "Sin estibar" for an adopted row with nothing scanned yet', () => {
    render(
      <PackageRow
        index={1}
        pkg={{ ...pkg, stage: 'adopted', boxesTotal: 2, boxesLoaded: 0 }}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText(/sin estibar/i)).toBeInTheDocument();
  });

  it('does not show the unstaged marker for a fully-loaded adopted row', () => {
    const { container } = render(
      <PackageRow
        index={1}
        pkg={{ ...pkg, stage: 'adopted', boxesTotal: 2, boxesLoaded: 2 }}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.queryByText(/sin estibar/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/estibados/i)).not.toBeInTheDocument();
    expect(container.querySelector('.border-status-warning')).not.toBeInTheDocument();
  });

  /**
   * spec-70 phase 4, breakage #8: pkg.status is dispatches.status
   * (dispatch_status_enum), a vocabulary `PACKAGE_STATUS_CONFIG` never
   * modelled — 'partial' had no entry there and rendered as the raw string
   * "partial" instead of a label. This regression-tests the fix.
   */
  it('renders a dispatch-status label for "partial", not the raw string', () => {
    render(<PackageRow index={1} pkg={{ ...pkg, status: 'partial' }} onRemove={vi.fn()} />);
    expect(screen.getByText('Parcial')).toBeInTheDocument();
    expect(screen.queryByText('partial')).not.toBeInTheDocument();
  });

  it('renders "delivered" as "Entregado"', () => {
    render(<PackageRow index={1} pkg={{ ...pkg, status: 'delivered' }} onRemove={vi.fn()} />);
    expect(screen.getByText('Entregado')).toBeInTheDocument();
  });
});
