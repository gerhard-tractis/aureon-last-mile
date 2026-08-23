import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrderFilterRail } from './OrderFilterRail';
import { EMPTY_ORDERS_LIST_FILTERS, type OrdersListFilters } from '@/hooks/useOrdersList';

const baseFilters: OrdersListFilters = { ...EMPTY_ORDERS_LIST_FILTERS };

const statusOptions = [
  { status: 'en_ruta', label: 'En reparto', count: 318 },
  { status: 'entregado', label: 'Entregada', count: 904 },
];

function renderRail(overrides: Partial<React.ComponentProps<typeof OrderFilterRail>> = {}) {
  const onFiltersChange = vi.fn();
  const utils = render(
    <OrderFilterRail
      filters={baseFilters}
      onFiltersChange={onFiltersChange}
      statusOptions={statusOptions}
      routeOptions={[{ id: 'r-1', label: 'R-2481' }]}
      today="2026-08-22"
      {...overrides}
    />,
  );
  return { onFiltersChange, ...utils };
}

describe('OrderFilterRail', () => {
  it('checking an ESTADO checkbox adds that status to filters.statuses without mutating the frozen input', () => {
    const { onFiltersChange } = renderRail();
    const original = { ...baseFilters };
    screen.getByRole('checkbox', { name: /en reparto/i }).click();
    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ statuses: ['en_ruta'] }),
    );
    // The input object passed in must be untouched — resolvePreset's contract.
    expect(baseFilters).toEqual(original);
  });

  it('unchecking an already-selected ESTADO checkbox removes only that status', () => {
    const { onFiltersChange } = renderRail({
      filters: { ...baseFilters, statuses: ['en_ruta', 'entregado'] },
    });
    screen.getByRole('checkbox', { name: /en reparto/i }).click();
    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ statuses: ['entregado'] }),
    );
  });

  it('shows the count supplied for each ESTADO option', () => {
    renderRail();
    expect(screen.getByText('318')).toBeInTheDocument();
    expect(screen.getByText('904')).toBeInTheDocument();
  });

  describe('POD filter (three states: Todos / Con POD / Sin POD)', () => {
    // A checkbox can only express two states, but the system produces three:
    // null (no filter — the general case), true (Con POD), AND false (Sin
    // POD — what the `pendientes-pod` preset itself sets). A checkbox bound
    // to "hasPod === true" cannot represent the preset's own false state,
    // so toggling it twice from there silently leaves "Pendientes de POD"
    // for a different view than the tab still says is active. A segmented
    // control with a real "Todos" option is the only shape that can't lose
    // that state.
    it('selects "Todos" when hasPod is null', () => {
      renderRail({ filters: { ...baseFilters, hasPod: null } });
      expect(screen.getByRole('radio', { name: 'Todos' })).toBeChecked();
    });

    it('selects "Sin POD" when hasPod is false — distinct from null, never collapsed to "Todos"', () => {
      renderRail({ filters: { ...baseFilters, hasPod: false } });
      expect(screen.getByRole('radio', { name: 'Sin POD' })).toBeChecked();
      expect(screen.getByRole('radio', { name: 'Todos' })).not.toBeChecked();
    });

    it('selects "Con POD" when hasPod is true', () => {
      renderRail({ filters: { ...baseFilters, hasPod: true } });
      expect(screen.getByRole('radio', { name: 'Con POD' })).toBeChecked();
    });

    it('choosing "Con POD" sets hasPod: true', async () => {
      const user = userEvent.setup();
      const { onFiltersChange } = renderRail();
      await user.click(screen.getByRole('radio', { name: 'Con POD' }));
      expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ hasPod: true }));
    });

    it('choosing "Sin POD" sets hasPod: false, reachable directly — not by toggling a checkbox twice', async () => {
      const user = userEvent.setup();
      const { onFiltersChange } = renderRail();
      await user.click(screen.getByRole('radio', { name: 'Sin POD' }));
      expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ hasPod: false }));
    });

    it('choosing "Todos" from either POD state sets hasPod: null', async () => {
      const user = userEvent.setup();
      const { onFiltersChange } = renderRail({ filters: { ...baseFilters, hasPod: false } });
      await user.click(screen.getByRole('radio', { name: 'Todos' }));
      expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ hasPod: null }));
    });
  });

  it('"2+ intentos de entrega" toggled on sets minAttempts: 2, and off sets minAttempts: null', async () => {
    const user = userEvent.setup();
    const { onFiltersChange } = renderRail();
    await user.click(screen.getByRole('checkbox', { name: /2\+ intentos de entrega/i }));
    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ minAttempts: 2 }));
  });

  it('renders minAttempts: 0 as UNCHECKED, distinct from null — it must not be read as falsy', () => {
    renderRail({ filters: { ...baseFilters, minAttempts: 0 } });
    const toggle = screen.getByRole('checkbox', { name: /2\+ intentos de entrega/i });
    expect(toggle).not.toBeChecked();
  });

  it('renders minAttempts: 2 as CHECKED', () => {
    renderRail({ filters: { ...baseFilters, minAttempts: 2 } });
    const toggle = screen.getByRole('checkbox', { name: /2\+ intentos de entrega/i });
    expect(toggle).toBeChecked();
  });

  it('clicking a date-range preset (delegated to OrderDateRangeFilter) updates dateFrom/dateTo', async () => {
    const user = userEvent.setup();
    const { onFiltersChange } = renderRail();
    await user.click(screen.getByRole('button', { name: 'Hoy' }));
    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ dateFrom: '2026-08-22', dateTo: '2026-08-22' }),
    );
  });

  it('changing the COURIER / CONDUCTOR field sets filters.driver, preserving the raw (untrimmed) value', () => {
    const { onFiltersChange } = renderRail();
    const input = screen.getByLabelText(/courier.*conductor/i);
    fireEvent.change(input, { target: { value: 'DispatchTrack' } });
    expect(onFiltersChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ driver: 'DispatchTrack' }),
    );
  });

  it('a leading space in COURIER / CONDUCTOR does not clear the field — only an entirely empty value does', () => {
    const { onFiltersChange } = renderRail();
    const input = screen.getByLabelText(/courier.*conductor/i);
    fireEvent.change(input, { target: { value: ' ' } });
    expect(onFiltersChange).toHaveBeenLastCalledWith(expect.objectContaining({ driver: ' ' }));
  });

  it('clearing the COURIER / CONDUCTOR field to empty sets filters.driver to null', () => {
    const { onFiltersChange } = renderRail({ filters: { ...baseFilters, driver: 'DispatchTrack' } });
    const input = screen.getByLabelText(/courier.*conductor/i);
    fireEvent.change(input, { target: { value: '' } });
    expect(onFiltersChange).toHaveBeenLastCalledWith(expect.objectContaining({ driver: null }));
  });

  it('changing CLIENTE / REMITENTE sets filters.client, and clearing it sets null', () => {
    const { onFiltersChange } = renderRail({ filters: { ...baseFilters, client: 'Falabella' } });
    const input = screen.getByLabelText(/cliente.*remitente/i);
    fireEvent.change(input, { target: { value: '' } });
    expect(onFiltersChange).toHaveBeenLastCalledWith(expect.objectContaining({ client: null }));
  });

  it('adding a comuna chip (delegated to OrderComunaChipsFilter) updates filters.comunas', async () => {
    const user = userEvent.setup();
    const { onFiltersChange } = renderRail();
    await user.click(screen.getByRole('button', { name: /añadir/i }));
    const addInput = screen.getByRole('textbox', { name: /nueva zona/i });
    await user.type(addInput, 'Ñuñoa{Enter}');
    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ comunas: ['Ñuñoa'] }));
  });

  it('choosing a route from RUTA sets routeIds to a one-element array, and "Todas las rutas" clears it', async () => {
    const user = userEvent.setup();
    const { onFiltersChange } = renderRail();
    const select = screen.getByLabelText(/ruta/i);
    await user.selectOptions(select, 'r-1');
    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ routeIds: ['r-1'] }));

    onFiltersChange.mockClear();
    await user.selectOptions(select, '');
    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ routeIds: null }));
  });
});
