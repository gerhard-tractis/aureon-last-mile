import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OrderCard } from './OrderCard';
import type { ScanRecord } from '@/hooks/pickup/usePickupScans';

describe('OrderCard', () => {
  const mockOrder = {
    id: 'order-1',
    order_number: 'ORD-001',
    customer_name: 'Juan Perez',
    comuna: 'Providencia',
    delivery_address: 'Av. Providencia 123',
    packages: [
      { id: 'pkg-1', label: 'CTN001', package_number: '1 of 2', sku_items: [], declared_weight_kg: 1.5 },
      { id: 'pkg-2', label: 'CTN002', package_number: '2 of 2', sku_items: [], declared_weight_kg: null },
    ],
  };

  const scansWithOneVerified: ScanRecord[] = [
    { id: 's1', barcode_scanned: 'CTN001', scan_result: 'verified', scanned_at: '2026-03-15T10:00:00Z', package_id: 'pkg-1' },
  ];

  const defaultProps = {
    order: mockOrder,
    scans: scansWithOneVerified,
    onManualVerify: vi.fn(),
  };

  it('renders order number and customer name', () => {
    render(<OrderCard {...defaultProps} />);
    expect(screen.getByText('ORD-001')).toBeInTheDocument();
    expect(screen.getByText(/Juan Perez/)).toBeInTheDocument();
  });

  it('renders comuna', () => {
    render(<OrderCard {...defaultProps} />);
    expect(screen.getByText(/Providencia/)).toBeInTheDocument();
  });

  it('shows verified count badge', () => {
    render(<OrderCard {...defaultProps} />);
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });

  it('starts collapsed — packages not visible', () => {
    render(<OrderCard {...defaultProps} />);
    expect(screen.queryByText('CTN001')).not.toBeInTheDocument();
  });

  it('expands on click — shows packages', () => {
    render(<OrderCard {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('Toggle order details'));
    expect(screen.getByText('CTN001')).toBeInTheDocument();
    expect(screen.getByText('CTN002')).toBeInTheDocument();
  });

  it('collapses on second click', () => {
    render(<OrderCard {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('Toggle order details'));
    fireEvent.click(screen.getByLabelText('Toggle order details'));
    expect(screen.queryByText('CTN001')).not.toBeInTheDocument();
  });

  it('shows green badge when all packages verified', () => {
    const allScans: ScanRecord[] = [
      { id: 's1', barcode_scanned: 'CTN001', scan_result: 'verified', scanned_at: '2026-03-15T10:00:00Z', package_id: 'pkg-1' },
      { id: 's2', barcode_scanned: 'CTN002', scan_result: 'verified', scanned_at: '2026-03-15T10:01:00Z', package_id: 'pkg-2' },
    ];
    render(<OrderCard {...defaultProps} scans={allScans} />);
    expect(screen.getByTestId('badge').className).toContain('green');
  });

  it('shows yellow badge when partially verified', () => {
    render(<OrderCard {...defaultProps} />);
    expect(screen.getByTestId('badge').className).toContain('yellow');
  });

  it('shows gray badge when none verified', () => {
    render(<OrderCard {...defaultProps} scans={[]} />);
    expect(screen.getByTestId('badge').className).toContain('gray');
  });

  it('shows empty state for order with 0 packages', () => {
    render(<OrderCard {...defaultProps} order={{ ...mockOrder, packages: [] }} />);
    fireEvent.click(screen.getByLabelText('Toggle order details'));
    expect(screen.getByText(/No packages/)).toBeInTheDocument();
  });
});
