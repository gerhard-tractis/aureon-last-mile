import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UnverifiedPackagesBlock } from './UnverifiedPackagesBlock';

vi.mock('./DiscrepancyItem', () => ({
  DiscrepancyItem: ({ packageLabel }: { packageLabel: string }) => (
    <div data-testid="discrepancy-item">{packageLabel}</div>
  ),
}));

describe('UnverifiedPackagesBlock', () => {
  it('renders nothing when there are no missing packages and no unexpected barcodes', () => {
    const { container } = render(
      <UnverifiedPackagesBlock
        missingPackages={[]}
        notFoundBarcodes={[]}
        noteMap={new Map()}
        onSaveNote={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows the literal warning naming the missing count', () => {
    render(
      <UnverifiedPackagesBlock
        missingPackages={[{ id: 'p1', label: 'CTN-1', order_id: 'o1', order_number: 'ORD-1' }]}
        notFoundBarcodes={[]}
        noteMap={new Map()}
        onSaveNote={vi.fn()}
      />
    );
    expect(
      screen.getByText(
        /si cierras ahora, los 1 quedan registrados como faltantes a tu nombre/i
      )
    ).toBeInTheDocument();
  });

  it('renders the SIN VERIFICAR list with one DiscrepancyItem per missing package', () => {
    render(
      <UnverifiedPackagesBlock
        missingPackages={[
          { id: 'p1', label: 'CTN-1', order_id: 'o1', order_number: 'ORD-1' },
          { id: 'p2', label: 'CTN-2', order_id: 'o1', order_number: 'ORD-1' },
        ]}
        notFoundBarcodes={[]}
        noteMap={new Map()}
        onSaveNote={vi.fn()}
      />
    );
    expect(screen.getByText(/sin verificar \(2\)/i)).toBeInTheDocument();
    expect(screen.getAllByTestId('discrepancy-item')).toHaveLength(2);
  });

  it('renders the NO ESTABAN EN LA CARGA block from unexpected barcodes', () => {
    render(
      <UnverifiedPackagesBlock
        missingPackages={[]}
        notFoundBarcodes={['BC-999', 'BC-888']}
        noteMap={new Map()}
        onSaveNote={vi.fn()}
      />
    );
    expect(screen.getByText(/no estaban en la carga \(2\)/i)).toBeInTheDocument();
    expect(screen.getByText('BC-999')).toBeInTheDocument();
    expect(screen.getByText('BC-888')).toBeInTheDocument();
  });

  it('does not render the warning or SIN VERIFICAR section with zero missing packages', () => {
    render(
      <UnverifiedPackagesBlock
        missingPackages={[]}
        notFoundBarcodes={['BC-999']}
        noteMap={new Map()}
        onSaveNote={vi.fn()}
      />
    );
    expect(screen.queryByText(/quedan registrados como faltantes/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sin verificar/i)).not.toBeInTheDocument();
  });
});
