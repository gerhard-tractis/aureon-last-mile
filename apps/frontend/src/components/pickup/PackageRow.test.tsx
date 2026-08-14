import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PackageRow } from './PackageRow';

const mockMutate = vi.fn();
let mockIsPending = false;
vi.mock('@/hooks/pickup/useExpandCarton', () => ({
  useExpandCarton: () => ({ mutate: mockMutate, isPending: mockIsPending }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe('PackageRow', () => {
  beforeEach(() => {
    mockMutate.mockReset();
    mockIsPending = false;
    window.navigator.onLine = true;
  });

  const defaultProps = {
    pkg: {
      id: 'pkg-1',
      label: 'CTN001',
      package_number: '1 of 3',
      sku_items: [{ sku: 'SKU1', description: 'Widget', quantity: 2 }],
      declared_weight_kg: 1.5,
    },
    isVerified: false,
    onManualVerify: vi.fn(),
  };

  it('renders package label', () => {
    render(<PackageRow {...defaultProps} />);
    expect(screen.getByText('CTN001')).toBeInTheDocument();
  });

  it('renders package number', () => {
    render(<PackageRow {...defaultProps} />);
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
  });

  it('renders SKU count', () => {
    render(<PackageRow {...defaultProps} />);
    expect(screen.getByText(/1 SKU/)).toBeInTheDocument();
  });

  it('renders declared weight', () => {
    render(<PackageRow {...defaultProps} />);
    expect(screen.getByText(/1.5\s*kg/)).toBeInTheDocument();
  });

  it('shows Mark Verified button when not verified', () => {
    render(<PackageRow {...defaultProps} />);
    expect(screen.getByRole('button', { name: /mark verified/i })).toBeInTheDocument();
  });

  it('calls onManualVerify with label when button clicked', () => {
    const onManualVerify = vi.fn();
    render(<PackageRow {...defaultProps} onManualVerify={onManualVerify} />);
    fireEvent.click(screen.getByRole('button', { name: /mark verified/i }));
    expect(onManualVerify).toHaveBeenCalledWith('CTN001');
  });

  it('shows checkmark and hides button when verified', () => {
    render(<PackageRow {...defaultProps} isVerified={true} />);
    expect(screen.queryByRole('button', { name: /mark verified/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('verified-icon')).toBeInTheDocument();
  });

  it('handles null package_number', () => {
    render(<PackageRow {...defaultProps} pkg={{ ...defaultProps.pkg, package_number: null }} />);
    expect(screen.queryByText('1 of 3')).not.toBeInTheDocument();
  });

  it('handles null weight', () => {
    render(<PackageRow {...defaultProps} pkg={{ ...defaultProps.pkg, declared_weight_kg: null }} />);
    expect(screen.queryByText(/kg/)).not.toBeInTheDocument();
  });

  it('handles empty SKU items', () => {
    render(<PackageRow {...defaultProps} pkg={{ ...defaultProps.pkg, sku_items: [] }} />);
    expect(screen.getByText(/0 SKUs/)).toBeInTheDocument();
  });

  it('shows expand chevron when SKU items exist', () => {
    render(<PackageRow {...defaultProps} />);
    expect(screen.getByLabelText('Ver SKUs')).toBeInTheDocument();
  });

  it('does not show expand chevron when no SKU items', () => {
    render(<PackageRow {...defaultProps} pkg={{ ...defaultProps.pkg, sku_items: [] }} />);
    expect(screen.queryByLabelText('Ver SKUs')).not.toBeInTheDocument();
  });

  it('expands to show SKU detail table on click', () => {
    const multiSkuPkg = {
      ...defaultProps.pkg,
      sku_items: [
        { sku: 'SKU1', description: 'Widget', quantity: 2 },
        { sku: 'SKU2', description: 'Gadget', quantity: 5 },
      ],
    };
    render(<PackageRow {...defaultProps} pkg={multiSkuPkg} />);

    expect(screen.queryByTestId('sku-table')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Ver SKUs'));

    expect(screen.getByTestId('sku-table')).toBeInTheDocument();
    expect(screen.getByText('SKU1')).toBeInTheDocument();
    expect(screen.getByText('Widget')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('SKU2')).toBeInTheDocument();
    expect(screen.getByText('Gadget')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('collapses SKU table on second click', () => {
    render(<PackageRow {...defaultProps} />);

    fireEvent.click(screen.getByLabelText('Ver SKUs'));
    expect(screen.getByTestId('sku-table')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Ocultar SKUs'));
    expect(screen.queryByTestId('sku-table')).not.toBeInTheDocument();
  });

  describe('spec-55 carton expansion', () => {
    it('shows the "Agregar bultos" button on a parent (non-generated) package', () => {
      render(<PackageRow {...defaultProps} />);
      expect(screen.getByRole('button', { name: /agregar bultos/i })).toBeInTheDocument();
    });

    it('hides the "Agregar bultos" button on a minted sibling', () => {
      render(
        <PackageRow
          {...defaultProps}
          pkg={{ ...defaultProps.pkg, label: 'CTN001-2', is_generated_label: true, parent_label: 'CTN001' }}
        />
      );
      expect(screen.queryByRole('button', { name: /agregar bultos/i })).not.toBeInTheDocument();
    });

    it('shows the Aureon-generated badge on a minted sibling', () => {
      render(
        <PackageRow
          {...defaultProps}
          pkg={{ ...defaultProps.pkg, label: 'CTN001-2', is_generated_label: true, parent_label: 'CTN001' }}
        />
      );
      expect(screen.getByTestId('generated-badge')).toBeInTheDocument();
    });

    it('does not show the generated badge on the parent', () => {
      render(<PackageRow {...defaultProps} />);
      expect(screen.queryByTestId('generated-badge')).not.toBeInTheDocument();
    });

    it('disables the button when offline', () => {
      window.navigator.onLine = false;
      render(<PackageRow {...defaultProps} />);
      expect(screen.getByRole('button', { name: /agregar bultos/i })).toBeDisabled();
    });

    it('opens the expand sheet on click and previews the next label', () => {
      render(<PackageRow {...defaultProps} existingBoxCount={1} />);
      fireEvent.click(screen.getByRole('button', { name: /agregar bultos/i }));
      expect(screen.getByText(/Agregar bultos a CTN001/)).toBeInTheDocument();
      expect(screen.getByTestId('expand-preview')).toHaveTextContent('CTN001-2');
    });

    it('confirming the sheet calls the expand mutation with the package id', () => {
      render(<PackageRow {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /agregar bultos/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Producto de varias cajas' }));
      fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));

      expect(mockMutate).toHaveBeenCalledWith(
        { packageId: 'pkg-1', additionalBoxes: 1, reason: 'Producto de varias cajas' },
        expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) })
      );
    });
  });
});
