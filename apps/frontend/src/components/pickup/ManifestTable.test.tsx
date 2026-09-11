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

  // spec-95 fase 8 (mock 5a, Recogida.dc.html:110) — the label-printing
  // column had the action wired since spec-53, and the header row already
  // had eight aligned `<span>`s (the eighth was an empty one over the print
  // button) — the grid was never misaligned. What was missing was the TEXT
  // of that eighth header cell. (Review round 1, C5: an earlier version of
  // this comment claimed a 7-vs-8 misalignment that never existed —
  // verified against `4bd1c02`, corrected here.)
  it('names the eighth column ETIQUETAS, over the print action — when the module is on', () => {
    render(<ManifestTable rows={[row()]} labelsEnabled emptyMessage="vacío" />);
    expect(screen.getByText('Etiquetas')).toBeInTheDocument();
  });

  // m2 (review round 1) — the label column's track was 32px, too narrow
  // for the word "Etiquetas" (~59px at this size); the mock reserves 86px
  // because its action is a text button, not just an icon. This asserts
  // the CLASS that reserves the width, not just that the text renders —
  // jsdom does not lay anything out, so only the class is checkable here.
  it('reserves enough width in the grid for the ETIQUETAS header text', () => {
    render(<ManifestTable rows={[row()]} labelsEnabled emptyMessage="vacío" />);
    const row_ = screen.getByTestId('manifest-row');
    expect(row_.className).toContain('96px_64px');
  });

  // B3 — the header text is not decoration. `labelsEnabled` already gates
  // the print action per row (":70", spec-53's own module gate); an
  // operator without PACKAGE_LABELS must not see a column titled ETIQUETAS
  // that never does anything, on every cold load of this screen.
  it('hides the ETIQUETAS header when the labels module is off', () => {
    render(<ManifestTable rows={[row()]} emptyMessage="vacío" />);
    expect(screen.queryByText('Etiquetas')).toBeNull();
  });

  // C4 — a text-presence assertion alone lets ETIQUETAS and Ventana swap
  // places and still pass. The header's eight cells align 1:1 with the
  // eight data columns of GRID, so ETIQUETAS has to come AFTER Ventana.
  it('keeps ETIQUETAS after Ventana in the header, matching the data columns below', () => {
    render(<ManifestTable rows={[row()]} labelsEnabled emptyMessage="vacío" />);
    const ventana = screen.getByText('Ventana');
    const etiquetas = screen.getByText('Etiquetas');
    expect(ventana.compareDocumentPosition(etiquetas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  describe('columna de ventana (spec-83 fase 2)', () => {
    const now = new Date('2026-09-10T12:30:00');

    it('renders the header', () => {
      render(<ManifestTable rows={[row()]} emptyMessage="vacío" />);
      expect(screen.getByText('Ventana')).toBeInTheDocument();
    });

    it('shows "sin datos" — gray, not green — when the pickup point has no window configured', () => {
      // Today no pickup point has this configured. Painting this green would
      // assert "plenty of time" over an absence of information.
      render(<ManifestTable rows={[row()]} emptyMessage="vacío" now={now} />);
      const cell = screen.getByTestId('pickup-window');
      expect(cell).toHaveAttribute('data-status', 'sin_datos');
      expect(cell).toHaveTextContent('Sin datos');
    });

    it('shows dentro_de_plazo well before the window closes', () => {
      render(
        <ManifestTable
          rows={[row({ pickupWindowStart: '09:00', pickupWindowEnd: '20:00' })]}
          emptyMessage="vacío"
          now={now}
        />,
      );
      const cell = screen.getByTestId('pickup-window');
      expect(cell).toHaveAttribute('data-status', 'dentro_de_plazo');
      expect(cell).toHaveTextContent('09:00–20:00');
    });

    it('shows cerca_del_cierre near the close time', () => {
      render(
        <ManifestTable
          rows={[row({ pickupWindowStart: '09:00', pickupWindowEnd: '13:00' })]}
          emptyMessage="vacío"
          now={now}
        />,
      );
      const cell = screen.getByTestId('pickup-window');
      expect(cell).toHaveAttribute('data-status', 'cerca_del_cierre');
    });

    it('does not touch the left border — window status is a column, not a row state', () => {
      render(
        <ManifestTable
          rows={[row({ pickupWindowStart: '09:00', pickupWindowEnd: '13:00' })]}
          emptyMessage="vacío"
          now={now}
        />,
      );
      // Not selected, not in progress -> the border must still read transparent.
      expect(screen.getByTestId('manifest-row').className).toContain('border-l-transparent');
    });
  });
});
