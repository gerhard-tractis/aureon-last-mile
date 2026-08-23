import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrdersPageHeader } from './_orders-header';

describe('OrdersPageHeader', () => {
  it('shows the real current-query total_count, not a hardcoded number', () => {
    render(
      <OrdersPageHeader
        totalCount={47}
        pageRowCount={12}
        onExportCurrentPage={vi.fn()}
        onCopyShareableUrl={vi.fn()}
      />,
    );
    expect(screen.getByText(/47 pedidos/)).toBeInTheDocument();
  });

  it('names the export action and how much it covers in the label itself — "Exportar página (N)" with the live loaded-row count', () => {
    render(
      <OrdersPageHeader
        totalCount={47}
        pageRowCount={12}
        onExportCurrentPage={vi.fn()}
        onCopyShareableUrl={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Exportar página (12)' })).toBeInTheDocument();
  });

  it('"Exportar página" calls onExportCurrentPage, distinct from the bulk bar\'s own export', () => {
    const onExportCurrentPage = vi.fn();
    render(
      <OrdersPageHeader
        totalCount={1}
        pageRowCount={1}
        onExportCurrentPage={onExportCurrentPage}
        onCopyShareableUrl={vi.fn()}
      />,
    );
    screen.getByRole('button', { name: /exportar página/i }).click();
    expect(onExportCurrentPage).toHaveBeenCalledTimes(1);
  });

  it('"Guardar vista" calls onCopyShareableUrl', () => {
    const onCopyShareableUrl = vi.fn();
    render(
      <OrdersPageHeader
        totalCount={1}
        pageRowCount={1}
        onExportCurrentPage={vi.fn()}
        onCopyShareableUrl={onCopyShareableUrl}
      />,
    );
    screen.getByRole('button', { name: /guardar vista/i }).click();
    expect(onCopyShareableUrl).toHaveBeenCalledTimes(1);
  });

  it('titles the export button explaining it covers only the current page, not the full filtered view', () => {
    render(
      <OrdersPageHeader
        totalCount={47}
        pageRowCount={12}
        onExportCurrentPage={vi.fn()}
        onCopyShareableUrl={vi.fn()}
      />,
    );
    const exportButton = screen.getByRole('button', { name: /exportar página/i });
    expect(exportButton).toHaveAttribute('title', expect.stringContaining('esta página'));
  });
});
