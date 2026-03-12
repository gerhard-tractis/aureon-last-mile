import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScanHistoryList } from './ScanHistoryList';

describe('ScanHistoryList', () => {
  const mockScans = [
    {
      id: '1',
      barcode_scanned: 'CTN001',
      scan_result: 'verified' as const,
      scanned_at: '2026-03-10T10:00:00Z',
      package_id: 'pkg1',
    },
    {
      id: '2',
      barcode_scanned: 'CTN002',
      scan_result: 'not_found' as const,
      scanned_at: '2026-03-10T10:01:00Z',
      package_id: null,
    },
    {
      id: '3',
      barcode_scanned: 'CTN003',
      scan_result: 'duplicate' as const,
      scanned_at: '2026-03-10T10:02:00Z',
      package_id: null,
    },
  ];

  it('renders scan barcodes', () => {
    render(<ScanHistoryList scans={mockScans} />);
    expect(screen.getByText('CTN001')).toBeInTheDocument();
    expect(screen.getByText('CTN002')).toBeInTheDocument();
  });

  it('shows empty message when no scans', () => {
    render(<ScanHistoryList scans={[]} />);
    expect(screen.getByText('No scans yet')).toBeInTheDocument();
  });

  it('limits to maxItems', () => {
    const manyScans = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      barcode_scanned: `CTN${i}`,
      scan_result: 'verified' as const,
      scanned_at: '2026-03-10T10:00:00Z',
      package_id: null,
    }));
    render(<ScanHistoryList scans={manyScans} maxItems={3} />);
    expect(screen.getByText('CTN0')).toBeInTheDocument();
    expect(screen.queryByText('CTN3')).not.toBeInTheDocument();
  });
});
