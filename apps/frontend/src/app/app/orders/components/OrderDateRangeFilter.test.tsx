import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrderDateRangeFilter } from './OrderDateRangeFilter';

function renderFilter(overrides: Partial<React.ComponentProps<typeof OrderDateRangeFilter>> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <OrderDateRangeFilter dateFrom={null} dateTo={null} today="2026-08-22" onChange={onChange} {...overrides} />,
  );
  return { onChange, ...utils };
}

describe('OrderDateRangeFilter', () => {
  it('clicking "Hoy" sets dateFrom = dateTo = today', async () => {
    const user = userEvent.setup();
    const { onChange } = renderFilter();
    await user.click(screen.getByRole('button', { name: 'Hoy' }));
    expect(onChange).toHaveBeenCalledWith({ dateFrom: '2026-08-22', dateTo: '2026-08-22' });
  });

  it('clicking "7d" sets a 7-day range ending today', async () => {
    const user = userEvent.setup();
    const { onChange } = renderFilter();
    await user.click(screen.getByRole('button', { name: '7d' }));
    expect(onChange).toHaveBeenCalledWith({ dateFrom: '2026-08-16', dateTo: '2026-08-22' });
  });

  it('clicking "30d" sets a 30-day range ending today', async () => {
    const user = userEvent.setup();
    const { onChange } = renderFilter();
    await user.click(screen.getByRole('button', { name: '30d' }));
    expect(onChange).toHaveBeenCalledWith({ dateFrom: '2026-07-24', dateTo: '2026-08-22' });
  });

  it('computes date-preset boundaries correctly regardless of the test runner local timezone (UTC-safe arithmetic)', async () => {
    const user = userEvent.setup();
    // A "today" at a month boundary is the case naive local-time-then-toISOString
    // arithmetic gets wrong in positive-UTC-offset timezones.
    const { onChange } = renderFilter({ today: '2026-03-01' });
    await user.click(screen.getByRole('button', { name: '7d' }));
    expect(onChange).toHaveBeenCalledWith({ dateFrom: '2026-02-23', dateTo: '2026-03-01' });
  });

  it('clicking "Rango" while already on "Hoy" reveals the two date inputs — not a same-value no-op', async () => {
    const user = userEvent.setup();
    renderFilter({ dateFrom: '2026-08-22', dateTo: '2026-08-22' });
    expect(screen.queryByLabelText('Desde')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Rango' }));
    expect(screen.getByLabelText('Desde')).toBeInTheDocument();
    expect(screen.getByLabelText('Hasta')).toBeInTheDocument();
  });

  it('editing the custom "Desde" input preserves the existing "Hasta" value', async () => {
    const { onChange } = renderFilter({ dateFrom: '2026-08-01', dateTo: '2026-08-10' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Rango' }));
    const desde = screen.getByLabelText('Desde') as HTMLInputElement;
    fireEvent.change(desde, { target: { value: '2026-08-05' } });
    expect(onChange).toHaveBeenLastCalledWith({ dateFrom: '2026-08-05', dateTo: '2026-08-10' });
  });
});
