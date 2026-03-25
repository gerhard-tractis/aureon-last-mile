import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PackageRow } from './PackageRow';

describe('PackageRow', () => {
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
});
