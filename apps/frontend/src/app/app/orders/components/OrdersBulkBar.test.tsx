import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrdersBulkBar } from './OrdersBulkBar';
import type { OrdersListRow } from '@/hooks/useOrdersList';

// jsdom doesn't implement these — same pattern as AuditLogExport.test.tsx.
beforeEach(() => {
  if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  if (!URL.revokeObjectURL) URL.revokeObjectURL = vi.fn();
});

function makeRow(overrides: Partial<OrdersListRow> = {}): OrdersListRow {
  return {
    id: 'o-1',
    order_number: 'ORD-1',
    customer_name: 'Cliente, con "comillas"',
    leading_status: 'entregado',
    comuna: 'La Florida',
    package_count: 2,
    route_label: 'R-1',
    driver_name: 'M. Rojas',
    sla_status: 'none',
    minutes_remaining: 0,
    last_event_at: null,
    last_event_label: 'entregada',
    has_pod: true,
    total_count: 1,
    ...overrides,
  };
}

describe('OrdersBulkBar', () => {
  it('renders nothing when no rows are selected', () => {
    const { container } = render(<OrdersBulkBar selectedRows={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the selected count when rows are selected', () => {
    render(<OrdersBulkBar selectedRows={[makeRow(), makeRow({ id: 'o-2' })]} />);
    expect(screen.getByText(/2/)).toBeInTheDocument();
    expect(screen.getByText(/seleccionados/i)).toBeInTheDocument();
  });

  it('renders ONLY the Exportar action — the four unbacked bulk actions are absent (spec-65 Decision 3)', () => {
    render(<OrdersBulkBar selectedRows={[makeRow()]} />);
    expect(screen.getByRole('button', { name: /exportar/i })).toBeInTheDocument();
    expect(screen.queryByText(/reasignar ruta/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/marcar excepción/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/reintentar entrega/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/notificar cliente/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('clicking Exportar builds a CSV from the selected rows and triggers a download', async () => {
    const user = userEvent.setup();
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<OrdersBulkBar selectedRows={[makeRow()]} />);
    await user.click(screen.getByRole('button', { name: /exportar/i }));

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    const blobArg = createObjectURLSpy.mock.calls[0][0] as Blob;
    const buffer = await blobArg.arrayBuffer();
    const text = new TextDecoder('utf-8').decode(buffer);
    expect(text).toContain('ORD-1');
    expect(text).toContain('"Cliente, con ""comillas"""');
    expect(clickSpy).toHaveBeenCalledTimes(1);

    createObjectURLSpy.mockRestore();
    clickSpy.mockRestore();
  });
});
