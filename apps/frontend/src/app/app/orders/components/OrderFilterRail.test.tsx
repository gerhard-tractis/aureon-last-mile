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

  it('"Solo con prueba de entrega" toggled on sets hasPod: true, and off sets hasPod: null', async () => {
    const user = userEvent.setup();
    const { onFiltersChange, rerender } = renderRail();
    const toggle = screen.getByRole('checkbox', { name: /solo con prueba de entrega/i });
    await user.click(toggle);
    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ hasPod: true }));

    onFiltersChange.mockClear();
    rerender(
      <OrderFilterRail
        filters={{ ...baseFilters, hasPod: true }}
        onFiltersChange={onFiltersChange}
        statusOptions={statusOptions}
        routeOptions={[]}
        today="2026-08-22"
      />,
    );
    await user.click(screen.getByRole('checkbox', { name: /solo con prueba de entrega/i }));
    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ hasPod: null }));
  });

  it('renders hasPod: false as UNCHECKED, distinct from null — it must not be read as falsy', () => {
    renderRail({ filters: { ...baseFilters, hasPod: false } });
    const toggle = screen.getByRole('checkbox', { name: /solo con prueba de entrega/i });
    expect(toggle).not.toBeChecked();
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

  it('clicking "Hoy" sets dateFrom = dateTo = today', async () => {
    const user = userEvent.setup();
    const { onFiltersChange } = renderRail();
    await user.click(screen.getByRole('button', { name: 'Hoy' }));
    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ dateFrom: '2026-08-22', dateTo: '2026-08-22' }),
    );
  });

  it('clicking "Rango" while already on "Hoy" reveals the two date inputs — not a same-value no-op', async () => {
    const user = userEvent.setup();
    renderRail({ filters: { ...baseFilters, dateFrom: '2026-08-22', dateTo: '2026-08-22' } });
    expect(screen.queryByLabelText('Desde')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Rango' }));
    expect(screen.getByLabelText('Desde')).toBeInTheDocument();
    expect(screen.getByLabelText('Hasta')).toBeInTheDocument();
  });

  it('clicking "7d" sets a 7-day range ending today', async () => {
    const user = userEvent.setup();
    const { onFiltersChange } = renderRail();
    await user.click(screen.getByRole('button', { name: '7d' }));
    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ dateFrom: '2026-08-16', dateTo: '2026-08-22' }),
    );
  });

  it('changing the COURIER / CONDUCTOR field sets filters.driver', () => {
    const { onFiltersChange } = renderRail();
    const input = screen.getByLabelText(/courier.*conductor/i);
    fireEvent.change(input, { target: { value: 'DispatchTrack' } });
    expect(onFiltersChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ driver: 'DispatchTrack' }),
    );
  });

  it('clearing the COURIER / CONDUCTOR field sets filters.driver to null', () => {
    const { onFiltersChange } = renderRail({ filters: { ...baseFilters, driver: 'DispatchTrack' } });
    const input = screen.getByLabelText(/courier.*conductor/i);
    fireEvent.change(input, { target: { value: '' } });
    expect(onFiltersChange).toHaveBeenLastCalledWith(expect.objectContaining({ driver: null }));
  });

  it('adding a comuna chip appends it, and clicking its × removes it', async () => {
    const user = userEvent.setup();
    const { onFiltersChange, rerender } = renderRail({
      filters: { ...baseFilters, comunas: ['La Florida'] },
    });
    expect(screen.getByText(/La Florida/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /quitar la florida/i }));
    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ comunas: null }));

    onFiltersChange.mockClear();
    rerender(
      <OrderFilterRail
        filters={baseFilters}
        onFiltersChange={onFiltersChange}
        statusOptions={statusOptions}
        routeOptions={[]}
        today="2026-08-22"
      />,
    );
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
