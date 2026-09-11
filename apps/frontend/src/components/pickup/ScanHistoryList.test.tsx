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
    expect(screen.getByText('Sin escaneos todavía')).toBeInTheDocument();
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

  it('shows the not-in-load reason instead of a timestamp for not_found scans', () => {
    render(<ScanHistoryList scans={mockScans} />);
    expect(screen.getByText('NO ESTÁ EN LA CARGA')).toBeInTheDocument();
  });

  it('shows a timestamp, not a reason, for verified scans', () => {
    render(<ScanHistoryList scans={[mockScans[0]]} />);
    expect(screen.queryByText('NO ESTÁ EN LA CARGA')).not.toBeInTheDocument();
    expect(screen.getByText(/\d{1,2}:\d{2}:\d{2}/)).toBeInTheDocument();
  });

  it('renders one status dot per row', () => {
    render(<ScanHistoryList scans={mockScans} />);
    expect(screen.getAllByTestId('scan-history-dot')).toHaveLength(3);
  });

  it('shows the already-scanned reason instead of a timestamp for duplicate scans', () => {
    render(<ScanHistoryList scans={mockScans} />);
    expect(screen.getByText('YA ESCANEADO')).toBeInTheDocument();
  });

  // M2, ronda 4 de review del PR #727 — sin red, `usePickupScans` (query de
  // red) queda pausada y `scans` llega `[]` por falta de SEÑAL, no por
  // falta de trabajo. Antes de esto, un operario que verificó 18 bultos con
  // señal y reabre esta pantalla sin red leía literalmente "No scans yet" —
  // la misma clase de cero fabricado que B2 (ronda 3) vino a eliminar dos
  // capas más arriba, sólo que aquí sobrevivió.
  it('shows a Spanish "sin conexión" message, not "Sin escaneos todavía", when scans is empty because of scansUnknown', () => {
    render(<ScanHistoryList scans={[]} scansUnknown />);
    expect(screen.queryByText('Sin escaneos todavía')).not.toBeInTheDocument();
    expect(screen.getByText(/sin conexión/i)).toBeInTheDocument();
  });

  it('still shows "Sin escaneos todavía" when scans is genuinely empty (not scansUnknown)', () => {
    render(<ScanHistoryList scans={[]} scansUnknown={false} />);
    expect(screen.getByText('Sin escaneos todavía')).toBeInTheDocument();
  });
});
