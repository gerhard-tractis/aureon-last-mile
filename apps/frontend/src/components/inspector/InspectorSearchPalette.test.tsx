import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { InspectorSearchPalette } from './InspectorSearchPalette';

vi.mock('@/hooks/useOrderSearch', () => ({
  useOrderSearch: (query: string) => ({
    data: query.length >= 2
      ? {
          orders: [{ id: 'o-1', order_number: 'ORD-999', customer_name: 'Ana López', leading_status: 'en_ruta' }],
          packages: [{ id: 'p-1', label: 'PKG-999-01', status: 'en_ruta', order_id: 'o-1', order_number: 'ORD-999' }],
        }
      : undefined,
    isLoading: false,
  }),
}));

vi.mock('@/components/StatusBadge', () => ({
  StatusBadge: ({ status }: { status: string }) => <span data-testid="status-badge">{status}</span>,
}));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(React.createElement(QueryClientProvider, { client: qc }, ui));
}

describe('InspectorSearchPalette', () => {
  it('renders when isOpen is true', () => {
    wrap(<InspectorSearchPalette isOpen onClose={vi.fn()} onSelectOrder={vi.fn()} />);
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('does not render input when closed', () => {
    wrap(<InspectorSearchPalette isOpen={false} onClose={vi.fn()} onSelectOrder={vi.fn()} />);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('shows order result after typing 2+ chars', async () => {
    wrap(<InspectorSearchPalette isOpen onClose={vi.fn()} onSelectOrder={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'OR' } });
    await waitFor(() => expect(screen.getByText('ORD-999')).toBeTruthy());
    expect(screen.getByText('Ana López')).toBeTruthy();
  });

  it('shows package result after typing 2+ chars', async () => {
    wrap(<InspectorSearchPalette isOpen onClose={vi.fn()} onSelectOrder={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'PK' } });
    await waitFor(() => expect(screen.getByText('PKG-999-01')).toBeTruthy());
  });

  it('calls onSelectOrder with order id when order row clicked', async () => {
    const onSelectOrder = vi.fn();
    wrap(<InspectorSearchPalette isOpen onClose={vi.fn()} onSelectOrder={onSelectOrder} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'OR' } });
    await waitFor(() => screen.getByText('ORD-999'));
    fireEvent.click(screen.getByText('ORD-999').closest('[data-result]')!);
    expect(onSelectOrder).toHaveBeenCalledWith('o-1');
  });

  it('calls onSelectOrder with order_id when package row clicked', async () => {
    const onSelectOrder = vi.fn();
    wrap(<InspectorSearchPalette isOpen onClose={vi.fn()} onSelectOrder={onSelectOrder} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'PK' } });
    await waitFor(() => screen.getByText('PKG-999-01'));
    fireEvent.click(screen.getByText('PKG-999-01').closest('[data-result]')!);
    expect(onSelectOrder).toHaveBeenCalledWith('o-1');
  });

  it('calls onClose when Escape key pressed', () => {
    const onClose = vi.fn();
    wrap(<InspectorSearchPalette isOpen onClose={onClose} onSelectOrder={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
