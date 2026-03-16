import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ManifestDetailList } from './ManifestDetailList';
import type { ManifestOrder } from '@/hooks/pickup/useManifestOrders';
import type { ScanRecord } from '@/hooks/pickup/usePickupScans';

describe('ManifestDetailList', () => {
  const mockOrders: ManifestOrder[] = [
    {
      id: 'order-1',
      order_number: 'ORD-001',
      customer_name: 'Juan Perez',
      comuna: 'Providencia',
      delivery_address: 'Av. Providencia 123',
      packages: [
        { id: 'pkg-1', label: 'CTN001', package_number: null, sku_items: [], declared_weight_kg: null },
        { id: 'pkg-2', label: 'CTN002', package_number: null, sku_items: [], declared_weight_kg: null },
      ],
    },
    {
      id: 'order-2',
      order_number: 'ORD-002',
      customer_name: 'Maria Lopez',
      comuna: 'Las Condes',
      delivery_address: 'Av. Las Condes 456',
      packages: [
        { id: 'pkg-3', label: 'CTN003', package_number: null, sku_items: [], declared_weight_kg: null },
      ],
    },
  ];

  const scans: ScanRecord[] = [
    { id: 's1', barcode_scanned: 'CTN001', scan_result: 'verified', scanned_at: '2026-03-15T10:00:00Z', package_id: 'pkg-1' },
  ];

  const defaultProps = {
    orders: mockOrders,
    scans: scans,
    onManualVerify: vi.fn(),
    isLoading: false,
    isError: false,
    onRetry: vi.fn(),
  };

  it('renders section title', () => {
    render(<ManifestDetailList {...defaultProps} />);
    expect(screen.getByText('Orders & Packages')).toBeInTheDocument();
  });

  it('renders summary badge with correct counts', () => {
    render(<ManifestDetailList {...defaultProps} />);
    expect(screen.getByText('1/3 verified')).toBeInTheDocument();
  });

  it('renders all order cards', () => {
    render(<ManifestDetailList {...defaultProps} />);
    expect(screen.getByText('ORD-001')).toBeInTheDocument();
    expect(screen.getByText('ORD-002')).toBeInTheDocument();
  });

  it('shows loading skeletons when loading', () => {
    render(<ManifestDetailList {...defaultProps} isLoading={true} orders={[]} />);
    expect(screen.queryByText('ORD-001')).not.toBeInTheDocument();
    expect(screen.getByTestId('manifest-detail-loading')).toBeInTheDocument();
  });

  it('shows error state with retry button', () => {
    const onRetry = vi.fn();
    render(<ManifestDetailList {...defaultProps} isError={true} orders={[]} onRetry={onRetry} />);
    expect(screen.getByText(/Failed to load/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('shows empty state when no orders', () => {
    render(<ManifestDetailList {...defaultProps} orders={[]} />);
    expect(screen.getByText(/No orders found/)).toBeInTheDocument();
  });
});
