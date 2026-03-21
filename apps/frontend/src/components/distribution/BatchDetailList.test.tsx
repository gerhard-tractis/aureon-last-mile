import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BatchDetailList } from './BatchDetailList';
import type { DockScanRecord } from '@/hooks/distribution/useDockScans';

const scans: DockScanRecord[] = [
  { id: 's1', barcode: 'PKG-001', scan_result: 'accepted', scanned_at: '2026-03-18T10:00:00Z', package_id: 'p1' },
];

describe('BatchDetailList', () => {
  it('renders scanned packages', () => {
    render(<BatchDetailList scans={scans} totalExpected={3} />);
    expect(screen.getByText('PKG-001')).toBeInTheDocument();
  });

  it('shows scanned count / total', () => {
    render(<BatchDetailList scans={scans} totalExpected={3} />);
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('shows empty state when no scans', () => {
    render(<BatchDetailList scans={[]} totalExpected={5} />);
    expect(screen.getByText(/ningún paquete/i)).toBeInTheDocument();
  });

  it('marks rejected scans differently', () => {
    const rejectedScans: DockScanRecord[] = [
      { id: 's2', barcode: 'PKG-BAD', scan_result: 'rejected', scanned_at: '2026-03-18T10:01:00Z', package_id: null },
    ];
    render(<BatchDetailList scans={rejectedScans} totalExpected={2} />);
    expect(screen.getByText('PKG-BAD')).toBeInTheDocument();
  });

  it('shows 0 / total when no accepted scans', () => {
    const rejectedScans: DockScanRecord[] = [
      { id: 's2', barcode: 'PKG-BAD', scan_result: 'rejected', scanned_at: '2026-03-18T10:01:00Z', package_id: null },
    ];
    render(<BatchDetailList scans={rejectedScans} totalExpected={5} />);
    expect(screen.getByText('0 / 5')).toBeInTheDocument();
  });
});
