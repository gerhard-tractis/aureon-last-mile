import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ManifestTable, type ManifestRow } from './ManifestTable';

function row(over: Partial<ManifestRow> = {}): ManifestRow {
  return {
    id: 'm1',
    externalLoadId: 'CARGA-99814',
    pickupPoint: 'Mall Plaza Vespucio',
    retailerName: 'Falabella',
    orderCount: 18,
    packageCount: 42,
    verifiedCount: 0,
    ...over,
  };
}

describe('ManifestTable', () => {
  it('renders the Spanish headers and a row', () => {
    render(<ManifestTable rows={[row()]} emptyMessage="vacío" />);
    for (const h of ['Carga', 'Punto de recogida', 'Cliente', 'Órdenes', 'Paq.']) {
      expect(screen.getByText(h)).toBeInTheDocument();
    }
    expect(screen.getByText('CARGA-99814')).toBeInTheDocument();
    expect(screen.getByText('Mall Plaza Vespucio')).toBeInTheDocument();
  });

  it('labels a manifest with no retailer rather than leaving the cell blank', () => {
    render(<ManifestTable rows={[row({ retailerName: null })]} emptyMessage="vacío" />);
    expect(screen.getByText('Sin cliente')).toBeInTheDocument();
  });

  it('toggles selection from anywhere on the row', async () => {
    const onToggle = vi.fn();
    render(
      <ManifestTable
        rows={[row()]}
        selectedIds={new Set()}
        onToggle={onToggle}
        emptyMessage="vacío"
      />,
    );
    await userEvent.click(screen.getByText('Falabella'));
    expect(onToggle).toHaveBeenCalledWith('m1');
  });

  it('cannot select a load that has no manifest row yet', () => {
    // spec-53: id is NULL until a manifests row exists, and a route can only
    // link something that exists.
    render(
      <ManifestTable
        rows={[row({ id: null })]}
        selectedIds={new Set()}
        onToggle={vi.fn()}
        emptyMessage="vacío"
      />,
    );
    expect(screen.getByTestId('manifest-row')).not.toHaveAttribute('aria-checked');
  });

  it('marks a load already being scanned', () => {
    render(<ManifestTable rows={[row({ verifiedCount: 3 })]} emptyMessage="vacío" />);
    expect(screen.getByTestId('manifest-row').className).toContain('border-l-status-warning');
  });

  it('opens the scan flow from the load code without toggling selection', async () => {
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    render(
      <ManifestTable
        rows={[row()]}
        selectedIds={new Set()}
        onToggle={onToggle}
        onOpen={onOpen}
        emptyMessage="vacío"
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'CARGA-99814' }));
    expect(onOpen).toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('keeps spec-53 label printing reachable from the row', async () => {
    const onPrintLabels = vi.fn();
    render(
      <ManifestTable
        rows={[row()]}
        labelsEnabled
        onPrintLabels={onPrintLabels}
        emptyMessage="vacío"
      />,
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Imprimir etiquetas de CARGA-99814' }),
    );
    expect(onPrintLabels).toHaveBeenCalledWith('m1');
  });

  it('shows no print affordance when the module is off', () => {
    render(<ManifestTable rows={[row()]} onPrintLabels={vi.fn()} emptyMessage="vacío" />);
    expect(screen.queryByRole('button', { name: /imprimir/i })).toBeNull();
  });

  it('shows the caller-supplied empty message', () => {
    render(<ManifestTable rows={[]} emptyMessage="No hay manifiestos pendientes de retiro." />);
    expect(screen.getByText('No hay manifiestos pendientes de retiro.')).toBeInTheDocument();
  });
});
