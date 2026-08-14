import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AtRiskPanel } from './AtRiskPanel';
import type { AtRiskOrder } from '@/hooks/ops-control/useAtRiskOrders';

function order(over: Partial<AtRiskOrder> = {}): AtRiskOrder {
  return {
    id: 'o1',
    orderNumber: 'ORD-48213',
    status: 'late',
    minutesRemaining: -100,
    label: '−1h 40m',
    stage: 'consolidation',
    retailer: 'Falabella',
    customer: 'M. Rojas',
    address: 'Av. Vicuña Mackenna 7110',
    comuna: 'La Florida',
    reasonFlag: 'no_driver',
    ...over,
  };
}

const BASE = {
  total: 47,
  page: 1,
  pageCount: 7,
  onPageChange: () => {},
  reasonFilter: null,
  onReasonFilterChange: () => {},
};

describe('AtRiskPanel', () => {
  it('renders the Spanish column headers from the mock', () => {
    render(<AtRiskPanel {...BASE} orders={[order()]} />);
    for (const h of ['Orden', 'Destino', 'Cliente', 'Etapa', 'Motivo', 'Promesa']) {
      expect(screen.getByText(h)).toBeInTheDocument();
    }
  });

  it('shows the comuna as the scannable part of the destination', () => {
    // Routing decisions are made by comuna, so it is set in the text colour at
    // semibold inside an otherwise muted address.
    render(<AtRiskPanel {...BASE} orders={[order()]} />);
    const comuna = screen.getByText('La Florida');
    expect(comuna.className).toContain('font-semibold');
    expect(comuna.className).toContain('text-text');
  });

  it('translates stage and reason through the Spanish label maps', () => {
    render(<AtRiskPanel {...BASE} orders={[order()]} />);
    const row = screen.getByTestId('at-risk-row');
    expect(within(row).getByText('Consolidación')).toBeInTheDocument();
    expect(within(row).getByText('Sin conductor')).toBeInTheDocument();
  });

  it('colours the row edge by SLA state', () => {
    render(
      <AtRiskPanel
        {...BASE}
        orders={[order({ id: 'a', status: 'late' }), order({ id: 'b', status: 'at_risk' })]}
      />,
    );
    const rows = screen.getAllByTestId('at-risk-row');
    expect(rows[0].className).toContain('border-l-status-error');
    expect(rows[1].className).toContain('border-l-status-warning');
  });

  it('builds reason chips with counts from the visible rows', () => {
    render(
      <AtRiskPanel
        {...BASE}
        orders={[
          order({ id: 'a', reasonFlag: 'no_driver' }),
          order({ id: 'b', reasonFlag: 'no_driver' }),
          order({ id: 'c', reasonFlag: 'inactive_route' }),
        ]}
      />,
    );
    expect(screen.getByRole('button', { name: 'Sin conductor · 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ruta inactiva · 1' })).toBeInTheDocument();
  });

  it('filters the rows to the active reason', () => {
    render(
      <AtRiskPanel
        {...BASE}
        reasonFilter="inactive_route"
        orders={[
          order({ id: 'a', orderNumber: 'ORD-1', reasonFlag: 'no_driver' }),
          order({ id: 'b', orderNumber: 'ORD-2', reasonFlag: 'inactive_route' }),
        ]}
      />,
    );
    expect(screen.getByText('ORD-2')).toBeInTheDocument();
    expect(screen.queryByText('ORD-1')).toBeNull();
  });

  it('toggles a chip off when it is already active', async () => {
    const onReasonFilterChange = vi.fn();
    render(
      <AtRiskPanel
        {...BASE}
        reasonFilter="no_driver"
        onReasonFilterChange={onReasonFilterChange}
        orders={[order()]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Sin conductor · 1' }));
    expect(onReasonFilterChange).toHaveBeenCalledWith(null);
  });

  it('opens the inspector for the clicked row', async () => {
    const onSelectOrder = vi.fn();
    render(<AtRiskPanel {...BASE} orders={[order()]} onSelectOrder={onSelectOrder} />);
    await userEvent.click(screen.getByText('ORD-48213'));
    expect(onSelectOrder).toHaveBeenCalledWith('o1');
  });

  it('says nothing needs action when the list is empty', () => {
    render(<AtRiskPanel {...BASE} orders={[]} total={0} />);
    expect(screen.getByText('Nada requiere acción ahora.')).toBeInTheDocument();
  });

  it('explains an empty list caused by the active filter differently', () => {
    // "Nothing needs action" would be a lie when the operator has simply
    // filtered everything out.
    render(<AtRiskPanel {...BASE} orders={[order()]} reasonFilter="unassigned" />);
    expect(screen.getByText('Ninguna orden con este motivo en esta página.')).toBeInTheDocument();
  });

  it('disables paging at the ends', () => {
    const { rerender } = render(<AtRiskPanel {...BASE} orders={[order()]} page={1} />);
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    rerender(<AtRiskPanel {...BASE} orders={[order()]} page={7} />);
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  });
});
