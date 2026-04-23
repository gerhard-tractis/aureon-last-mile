import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PreRouteAnden } from '@/lib/types';
import { PreRouteSelectionBar } from './PreRouteSelectionBar';

const makeAnden = (id: string, orderIds: string[], orderCount = orderIds.length, packageCount = orderIds.length * 2): PreRouteAnden => ({
  id,
  name: `Andén ${id}`,
  comunas_list: [],
  order_count: orderCount,
  package_count: packageCount,
  comunas: [],
  order_ids: orderIds,
  has_split_dock_zone_warnings: false,
});

const ANDEN_A = makeAnden('zone-1', ['ord-1', 'ord-2'], 2, 4);
const ANDEN_B = makeAnden('zone-2', ['ord-3'], 1, 2);

describe('PreRouteSelectionBar', () => {
  it('renders nothing when selection is empty', () => {
    const { container } = render(
      <PreRouteSelectionBar
        andenes={[ANDEN_A, ANDEN_B]}
        selectedAndenIds={new Set()}
        onCreateRoute={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the bar when at least one andén is selected', () => {
    render(
      <PreRouteSelectionBar
        andenes={[ANDEN_A, ANDEN_B]}
        selectedAndenIds={new Set(['zone-1'])}
        onCreateRoute={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /Crear ruta con selección/i })).toBeInTheDocument();
  });

  it('shows summed order and package totals for selected andenes', () => {
    render(
      <PreRouteSelectionBar
        andenes={[ANDEN_A, ANDEN_B]}
        selectedAndenIds={new Set(['zone-1', 'zone-2'])}
        onCreateRoute={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    // ANDEN_A: 2 orders 4 pkgs + ANDEN_B: 1 order 2 pkgs → 3 orders 6 pkgs
    expect(document.body.textContent).toMatch(/3.*órd/i);
    expect(document.body.textContent).toMatch(/6.*bulto/i);
  });

  it('shows "Crear ruta con selección" when exactly 1 andén is selected', () => {
    render(
      <PreRouteSelectionBar
        andenes={[ANDEN_A, ANDEN_B]}
        selectedAndenIds={new Set(['zone-1'])}
        onCreateRoute={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /Crear ruta con selección/i })).toBeInTheDocument();
    expect(screen.queryByText(/combinada/i)).not.toBeInTheDocument();
  });

  it('shows "Crear ruta combinada (N andenes)" when ≥2 andenes are selected', () => {
    render(
      <PreRouteSelectionBar
        andenes={[ANDEN_A, ANDEN_B]}
        selectedAndenIds={new Set(['zone-1', 'zone-2'])}
        onCreateRoute={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /Crear ruta combinada \(2 andenes\)/i })).toBeInTheDocument();
  });

  it('shows secondary warning line for multi-andén selection', () => {
    render(
      <PreRouteSelectionBar
        andenes={[ANDEN_A, ANDEN_B]}
        selectedAndenIds={new Set(['zone-1', 'zone-2'])}
        onCreateRoute={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText(/Una sola ruta con órdenes de varios andenes/i)).toBeInTheDocument();
  });

  it('does NOT show secondary warning line for single-andén selection', () => {
    render(
      <PreRouteSelectionBar
        andenes={[ANDEN_A, ANDEN_B]}
        selectedAndenIds={new Set(['zone-1'])}
        onCreateRoute={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Una sola ruta/i)).not.toBeInTheDocument();
  });

  it('calls onCreateRoute with merged order_ids of all selected andenes', () => {
    const mockCreate = vi.fn();
    render(
      <PreRouteSelectionBar
        andenes={[ANDEN_A, ANDEN_B]}
        selectedAndenIds={new Set(['zone-1', 'zone-2'])}
        onCreateRoute={mockCreate}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Crear ruta combinada/i }));
    expect(mockCreate).toHaveBeenCalledWith(['ord-1', 'ord-2', 'ord-3']);
  });

  it('calls onCreateRoute with single andén order_ids when only one selected', () => {
    const mockCreate = vi.fn();
    render(
      <PreRouteSelectionBar
        andenes={[ANDEN_A, ANDEN_B]}
        selectedAndenIds={new Set(['zone-1'])}
        onCreateRoute={mockCreate}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Crear ruta con selección/i }));
    expect(mockCreate).toHaveBeenCalledWith(['ord-1', 'ord-2']);
  });

  it('calls onClear when Limpiar is clicked', () => {
    const mockClear = vi.fn();
    render(
      <PreRouteSelectionBar
        andenes={[ANDEN_A, ANDEN_B]}
        selectedAndenIds={new Set(['zone-1'])}
        onCreateRoute={vi.fn()}
        onClear={mockClear}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Limpiar/i }));
    expect(mockClear).toHaveBeenCalledTimes(1);
  });

  it('has aria-live="polite" on the count announcement region', () => {
    render(
      <PreRouteSelectionBar
        andenes={[ANDEN_A, ANDEN_B]}
        selectedAndenIds={new Set(['zone-1'])}
        onCreateRoute={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(document.querySelector('[aria-live="polite"]')).not.toBeNull();
  });
});
