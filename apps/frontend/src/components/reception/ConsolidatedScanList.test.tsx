import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ConsolidatedScanList } from './ConsolidatedScanList';

const manifests = [
  { id: 'm1', external_load_id: 'CARGA-001', retailer_name: 'Easy' },
  { id: 'm2', external_load_id: 'CARGA-002', retailer_name: 'Sodimac' },
];

const expectedPackages = [
  { id: 'pkg-1', label: 'PKG-A', order_id: 'o1', order_number: '101', manifest_id: 'm1', status: 'verificado' },
  { id: 'pkg-2', label: 'PKG-B', order_id: 'o1', order_number: '101', manifest_id: 'm1', status: 'verificado' },
  { id: 'pkg-3', label: 'PKG-C', order_id: 'o2', order_number: '202', manifest_id: 'm2', status: 'verificado' },
];

describe('ConsolidatedScanList', () => {
  it('renders empty state when no expected packages', () => {
    render(<ConsolidatedScanList manifests={[]} expectedPackages={[]} scans={[]} />);
    expect(screen.getByText(/no hay paquetes esperados/i)).toBeInTheDocument();
  });

  it('groups packages by order across manifests', () => {
    render(
      <ConsolidatedScanList
        manifests={manifests}
        expectedPackages={expectedPackages}
        scans={[]}
      />,
    );
    const groups = screen.getAllByTestId('order-group');
    expect(groups).toHaveLength(2);
    expect(screen.getByText('Pedido #101')).toBeInTheDocument();
    expect(screen.getByText('Pedido #202')).toBeInTheDocument();
  });

  it('marks scanned packages as received', () => {
    render(
      <ConsolidatedScanList
        manifests={manifests}
        expectedPackages={expectedPackages}
        scans={[
          { id: 's1', barcode: 'PKG-B', scan_result: 'received', package_id: 'pkg-2', scanned_at: '2026-06-25T10:00:00Z' },
        ]}
      />,
    );

    const rows = screen.getAllByTestId('package-row');
    const receivedRow = rows.find((r) => r.getAttribute('data-package-id') === 'pkg-2')!;
    expect(receivedRow.getAttribute('data-received')).toBe('true');
    expect(within(receivedRow).getByTestId('received-icon')).toBeInTheDocument();
  });

  it('shows retailer per order', () => {
    render(
      <ConsolidatedScanList
        manifests={manifests}
        expectedPackages={expectedPackages}
        scans={[]}
      />,
    );
    expect(screen.getByText('Easy')).toBeInTheDocument();
    expect(screen.getByText('Sodimac')).toBeInTheDocument();
  });

  it('renders discrepancy section for not_found scans', () => {
    render(
      <ConsolidatedScanList
        manifests={manifests}
        expectedPackages={expectedPackages}
        scans={[
          { id: 's1', barcode: 'UNKNOWN', scan_result: 'not_found', package_id: null, scanned_at: '2026-06-25T10:00:00Z' },
        ]}
      />,
    );
    const section = screen.getByTestId('discrepancy-section');
    expect(within(section).getByText('UNKNOWN')).toBeInTheDocument();
    expect(within(section).getByText(/discrepancias \(1\)/i)).toBeInTheDocument();
  });
});
