import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrdersPageHeader } from './_orders-header';

describe('OrdersPageHeader', () => {
  it('shows the real current-query total_count, not a hardcoded number', () => {
    render(
      <OrdersPageHeader totalCount={47} onExportCurrentView={vi.fn()} onCopyShareableUrl={vi.fn()} />,
    );
    expect(screen.getByText(/47 pedidos/)).toBeInTheDocument();
  });

  it('"Exportar CSV" calls onExportCurrentView, distinct from the bulk bar\'s own Exportar', () => {
    const onExportCurrentView = vi.fn();
    render(
      <OrdersPageHeader
        totalCount={1}
        onExportCurrentView={onExportCurrentView}
        onCopyShareableUrl={vi.fn()}
      />,
    );
    screen.getByRole('button', { name: /exportar csv/i }).click();
    expect(onExportCurrentView).toHaveBeenCalledTimes(1);
  });

  it('"Guardar vista" calls onCopyShareableUrl', () => {
    const onCopyShareableUrl = vi.fn();
    render(
      <OrdersPageHeader totalCount={1} onExportCurrentView={vi.fn()} onCopyShareableUrl={onCopyShareableUrl} />,
    );
    screen.getByRole('button', { name: /guardar vista/i }).click();
    expect(onCopyShareableUrl).toHaveBeenCalledTimes(1);
  });

  it('gives each export action a distinguishing title so they are not confused', () => {
    render(
      <OrdersPageHeader totalCount={1} onExportCurrentView={vi.fn()} onCopyShareableUrl={vi.fn()} />,
    );
    const exportButton = screen.getByRole('button', { name: /exportar csv/i });
    expect(exportButton).toHaveAttribute('title', expect.stringContaining('vista actual'));
    expect(exportButton).toHaveAttribute('title', expect.stringContaining('selección'));
  });
});
