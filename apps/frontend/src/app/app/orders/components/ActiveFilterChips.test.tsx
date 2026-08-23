import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActiveFilterChips } from './ActiveFilterChips';
import { EMPTY_ORDERS_LIST_FILTERS, type OrdersListFilters } from '@/hooks/useOrdersList';

function renderChips(filters: OrdersListFilters, overrides: Record<string, unknown> = {}) {
  const onFiltersChange = vi.fn();
  const onClearAll = vi.fn();
  const onCopyShareableUrl = vi.fn();
  render(
    <ActiveFilterChips
      filters={filters}
      resultCount={47}
      onFiltersChange={onFiltersChange}
      onClearAll={onClearAll}
      onCopyShareableUrl={onCopyShareableUrl}
      {...overrides}
    />,
  );
  return { onFiltersChange, onClearAll, onCopyShareableUrl };
}

describe('ActiveFilterChips', () => {
  it('renders nothing filter-shaped when no filters are active — only the count remains', () => {
    renderChips({ ...EMPTY_ORDERS_LIST_FILTERS });
    expect(screen.queryByText(/estado:/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Limpiar')).not.toBeInTheDocument();
    expect(screen.getByText(/47 resultados/)).toBeInTheDocument();
  });

  it('renders one combined chip for multiple statuses, in human Spanish labels', () => {
    renderChips({ ...EMPTY_ORDERS_LIST_FILTERS, statuses: ['en_ruta', 'cancelado'] });
    expect(screen.getByText(/estado: en reparto, cancelada/i)).toBeInTheDocument();
  });

  it('renders a chip for the driver filter', () => {
    renderChips({ ...EMPTY_ORDERS_LIST_FILTERS, driver: 'DispatchTrack' });
    expect(screen.getByText(/courier: DispatchTrack/i)).toBeInTheDocument();
  });

  it('renders a chip for comunas', () => {
    renderChips({ ...EMPTY_ORDERS_LIST_FILTERS, comunas: ['La Florida'] });
    expect(screen.getByText(/zona: La Florida/i)).toBeInTheDocument();
  });

  it('removing a chip clears only that filter category via onFiltersChange', async () => {
    const user = userEvent.setup();
    const filters = { ...EMPTY_ORDERS_LIST_FILTERS, driver: 'DispatchTrack', comunas: ['La Florida'] };
    const { onFiltersChange } = renderChips(filters);
    await user.click(screen.getByRole('button', { name: /quitar courier/i }));
    expect(onFiltersChange).toHaveBeenCalledWith({ ...filters, driver: null });
  });

  it('"Limpiar" calls onClearAll, not onFiltersChange piecemeal', async () => {
    const user = userEvent.setup();
    const { onClearAll, onFiltersChange } = renderChips({
      ...EMPTY_ORDERS_LIST_FILTERS,
      driver: 'DispatchTrack',
    });
    await user.click(screen.getByRole('button', { name: 'Limpiar' }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
    expect(onFiltersChange).not.toHaveBeenCalled();
  });

  it('renders the result count', () => {
    renderChips({ ...EMPTY_ORDERS_LIST_FILTERS });
    expect(screen.getByText(/47 resultados/)).toBeInTheDocument();
  });

  it('clicking the shareable-URL affordance calls onCopyShareableUrl — it never touches the URL itself', async () => {
    const user = userEvent.setup();
    const { onCopyShareableUrl } = renderChips({ ...EMPTY_ORDERS_LIST_FILTERS });
    await user.click(screen.getByRole('button', { name: /url compartible/i }));
    expect(onCopyShareableUrl).toHaveBeenCalledTimes(1);
  });

  it('renders hasPod: false as an active filter chip, distinct from null (no chip)', () => {
    renderChips({ ...EMPTY_ORDERS_LIST_FILTERS, hasPod: false });
    expect(screen.getByText(/sin prueba de entrega/i)).toBeInTheDocument();
  });

  it('renders no POD chip when hasPod is null', () => {
    renderChips({ ...EMPTY_ORDERS_LIST_FILTERS, hasPod: null });
    expect(screen.queryByText(/prueba de entrega/i)).not.toBeInTheDocument();
  });

  it('renders minAttempts: 0 as an active filter chip, distinct from null (no chip)', () => {
    renderChips({ ...EMPTY_ORDERS_LIST_FILTERS, minAttempts: 0 });
    expect(screen.getByText(/intentos/i)).toBeInTheDocument();
  });
});
