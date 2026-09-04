import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RouteTrackingScanList } from './RouteTrackingScanList';
import type { ScanEntry } from '@/lib/dispatch/route-tracking';

function scan(overrides: Partial<ScanEntry> = {}): ScanEntry {
  return {
    packageId: 'p1',
    label: 'LBL-1',
    orderNumber: 'ORD-1',
    comuna: 'Ñuñoa',
    address: 'Av. Siempre Viva 123',
    customerName: 'Ana Soto',
    loadedAtIso: '2026-09-04T10:00:00-04:00',
    loadedBy: 'u1',
    stopNumber: 1,
    boxIndexInOrder: 1,
    boxesTotalInOrder: 1,
    ...overrides,
  };
}

describe('RouteTrackingScanList', () => {
  it('renders an empty message when nothing has been scanned', () => {
    render(<RouteTrackingScanList scans={[]} />);
    expect(screen.getByText(/todavía no hay paquetes escaneados/i)).toBeInTheDocument();
  });

  it('renders newest-first entries with a descending running index, order/comuna and address/client', () => {
    const scans = [
      scan({ packageId: 'p2', label: 'LBL-2', orderNumber: 'ORD-2', comuna: 'Providencia' }),
      scan({ packageId: 'p1', label: 'LBL-1', orderNumber: 'ORD-1', comuna: 'Ñuñoa' }),
    ];
    render(<RouteTrackingScanList scans={scans} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('2');
    expect(items[0]).toHaveTextContent('LBL-2');
    expect(items[0]).toHaveTextContent('ORD-2');
    expect(items[0]).toHaveTextContent('Providencia');
    expect(items[1]).toHaveTextContent('1');
    expect(items[1]).toHaveTextContent('LBL-1');
  });

  it('never renders a rejected-read row — accepted loads only (decision 12 / spec-79 H4)', () => {
    render(<RouteTrackingScanList scans={[scan()]} />);
    expect(screen.queryByText(/no se agregó/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/incompleta/i)).not.toBeInTheDocument();
  });
});
