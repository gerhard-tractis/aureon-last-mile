import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UnverifiedPackagesBlock } from './UnverifiedPackagesBlock';

vi.mock('./MissingPackageRow', () => ({
  MissingPackageRow: ({ packageLabel }: { packageLabel: string }) => (
    <div data-testid="missing-package-row">{packageLabel}</div>
  ),
}));

const baseCounts = {
  verifiedCount: 39,
  missingCount: 0,
  unexpectedCount: 0,
  totalCount: 42,
};

describe('UnverifiedPackagesBlock', () => {
  it('renders nothing when there are no missing packages and no unexpected barcodes', () => {
    const { container } = render(
      <UnverifiedPackagesBlock
        counts={baseCounts}
        missingPackages={[]}
        notFoundScans={[]}
        noteMap={new Map()}
        onSaveNote={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows the red "Faltan N paquetes" / "X de Y verificados" heading and the literal warning inside the same card', () => {
    render(
      <UnverifiedPackagesBlock
        counts={{ ...baseCounts, missingCount: 3, totalCount: 42 }}
        missingPackages={[{ id: 'p1', label: 'CTN-1', order_id: 'o1', order_number: 'ORD-1' }]}
        notFoundScans={[]}
        noteMap={new Map()}
        onSaveNote={vi.fn()}
      />
    );
    expect(screen.getByText('Faltan 3 paquetes')).toBeInTheDocument();
    expect(screen.getByText('39 de 42 verificados')).toBeInTheDocument();
    expect(
      screen.getByText(
        /si cierras ahora, los 3 quedan registrados como faltantes a tu nombre/i
      )
    ).toBeInTheDocument();
  });

  it('reads "Falta 1 paquete" (singular) when exactly one package is missing', () => {
    render(
      <UnverifiedPackagesBlock
        counts={{ ...baseCounts, missingCount: 1, verifiedCount: 41, totalCount: 42 }}
        missingPackages={[{ id: 'p1', label: 'CTN-1', order_id: 'o1', order_number: 'ORD-1' }]}
        notFoundScans={[]}
        noteMap={new Map()}
        onSaveNote={vi.fn()}
      />
    );
    expect(screen.getByText('Falta 1 paquete')).toBeInTheDocument();
    expect(screen.queryByText('Faltan 1 paquetes')).not.toBeInTheDocument();
  });

  it('renders the SIN VERIFICAR · N list with one MissingPackageRow per missing package', () => {
    render(
      <UnverifiedPackagesBlock
        counts={{ ...baseCounts, missingCount: 2 }}
        missingPackages={[
          { id: 'p1', label: 'CTN-1', order_id: 'o1', order_number: 'ORD-1' },
          { id: 'p2', label: 'CTN-2', order_id: 'o1', order_number: 'ORD-1' },
        ]}
        notFoundScans={[]}
        noteMap={new Map()}
        onSaveNote={vi.fn()}
      />
    );
    expect(screen.getByText('SIN VERIFICAR · 2')).toBeInTheDocument();
    expect(screen.getAllByTestId('missing-package-row')).toHaveLength(2);
  });

  it('renders the NO ESTABAN EN LA CARGA · N block with the scan time and each barcode', () => {
    render(
      <UnverifiedPackagesBlock
        counts={baseCounts}
        missingPackages={[]}
        notFoundScans={[{ barcode: 'CL7742119008', scannedAt: '2026-09-08T08:47:00Z' }]}
        noteMap={new Map()}
        onSaveNote={vi.fn()}
      />
    );
    expect(screen.getByText('NO ESTABAN EN LA CARGA · 1')).toBeInTheDocument();
    expect(screen.getByText('CL7742119008')).toBeInTheDocument();
    expect(screen.getByText(/no pertenece a este manifiesto/i)).toBeInTheDocument();
  });

  it('does not render the warning card or SIN VERIFICAR list with zero missing packages', () => {
    render(
      <UnverifiedPackagesBlock
        counts={baseCounts}
        missingPackages={[]}
        notFoundScans={[{ barcode: 'CL7742119008', scannedAt: '2026-09-08T08:47:00Z' }]}
        noteMap={new Map()}
        onSaveNote={vi.fn()}
      />
    );
    expect(screen.queryByText(/quedan registrados como faltantes/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sin verificar/i)).not.toBeInTheDocument();
  });
});
