import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScanResultCard } from './ScanResultCard';
import type { ScanRecord } from '@/hooks/pickup/usePickupScans';
import type { ManifestOrder } from '@/hooks/pickup/useManifestOrders';

const verifiedScan: ScanRecord = {
  id: 's1',
  barcode_scanned: 'CTN001',
  scan_result: 'verified',
  scanned_at: '2026-03-10T10:00:00Z',
  package_id: 'pkg1',
};

const notFoundScan: ScanRecord = {
  id: 's2',
  barcode_scanned: 'CTN999',
  scan_result: 'not_found',
  scanned_at: '2026-03-10T10:01:00Z',
  package_id: null,
};

const duplicateScan: ScanRecord = {
  id: 's3',
  barcode_scanned: 'CTN001',
  scan_result: 'duplicate',
  scanned_at: '2026-03-10T10:02:00Z',
  package_id: 'pkg1',
};

const order: ManifestOrder = {
  id: 'o1',
  order_number: 'ORD-1',
  customer_name: 'María López',
  comuna: 'Providencia',
  delivery_address: 'Av. Siempre Viva 123',
  packages: [
    { id: 'pkg1', label: 'CTN001', package_number: '1', sku_items: [], declared_weight_kg: null },
    { id: 'pkg2', label: 'CTN002', package_number: '2', sku_items: [], declared_weight_kg: null },
    { id: 'pkg3', label: 'CTN003', package_number: '3', sku_items: [], declared_weight_kg: null },
  ],
};

describe('ScanResultCard', () => {
  it('renders nothing when there is no scan yet', () => {
    const { container } = render(
      <ScanResultCard scan={null} order={null} verifiedInOrder={0} totalInOrder={0} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the verified headline and the scanned code', () => {
    render(
      <ScanResultCard scan={verifiedScan} order={null} verifiedInOrder={0} totalInOrder={0} />
    );
    expect(screen.getByText('Paquete verificado')).toBeInTheDocument();
    expect(screen.getByText('CTN001')).toBeInTheDocument();
  });

  it('shows the order context and position within the order when known', () => {
    render(
      <ScanResultCard scan={verifiedScan} order={order} verifiedInOrder={2} totalInOrder={3} />
    );
    expect(screen.getByText('María López')).toBeInTheDocument();
    expect(screen.getByText('Av. Siempre Viva 123')).toBeInTheDocument();
    expect(screen.getByText('paquete 2 de 3')).toBeInTheDocument();
  });

  it('omits the order context block entirely when no order is matched', () => {
    render(
      <ScanResultCard scan={verifiedScan} order={null} verifiedInOrder={0} totalInOrder={0} />
    );
    expect(screen.queryByText(/paquete .* de/)).not.toBeInTheDocument();
  });

  it('renders the not_found variant with its own headline, not a stale success', () => {
    render(
      <ScanResultCard scan={notFoundScan} order={null} verifiedInOrder={0} totalInOrder={0} />
    );
    expect(screen.getByText('No está en la carga')).toBeInTheDocument();
    expect(screen.getByText('CTN999')).toBeInTheDocument();
    expect(screen.queryByText('Paquete verificado')).not.toBeInTheDocument();
  });

  it('renders the duplicate variant with its own headline', () => {
    render(
      <ScanResultCard scan={duplicateScan} order={null} verifiedInOrder={0} totalInOrder={0} />
    );
    expect(screen.getByText('Ya fue escaneado')).toBeInTheDocument();
    expect(screen.queryByText('Paquete verificado')).not.toBeInTheDocument();
  });

  it('never renders the "saved on device" footer — no per-scan sync state exists to back it', () => {
    render(
      <ScanResultCard scan={verifiedScan} order={null} verifiedInOrder={0} totalInOrder={0} />
    );
    expect(screen.queryByText(/GUARDADO EN EL DISPOSITIVO/)).not.toBeInTheDocument();
  });
});
