import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DiscrepancyTable, computeDiscrepancyKpis } from './DiscrepancyTable';
import type { DiscrepancyRow } from '@/hooks/ops-control/useDiscrepancies';

const NOW = new Date('2026-09-07T12:00:00Z');

const ROWS: DiscrepancyRow[] = [
  {
    id: 'd-1', kind: 'missing', operation_type: 'reception', status: 'open',
    detected_at: '2026-09-07T10:00:00Z', note: null,
    order_number: 'ORD-01', package_label: 'CTN-1',
    carga: 'CARGA-EASY-001', ruta: 'PR-2026-2298', closed_by_name: 'Ana Recepción',
  },
  {
    id: 'd-2', kind: 'missing', operation_type: 'pickup', status: 'open',
    detected_at: '2026-09-06T12:00:00Z', note: 'El local no lo entregó.',
    order_number: 'ORD-02', package_label: 'CTN-2',
    carga: 'CARGA-EASY-002', ruta: 'PR-2026-2299', closed_by_name: 'Beto Recogida',
  },
];

describe('DiscrepancyTable', () => {
  it('shows an empty state when there are no rows', () => {
    render(<DiscrepancyTable rows={[]} now={NOW} />);
    expect(screen.getByText('Sin discrepancias abiertas')).toBeDefined();
  });

  it('renders one row per discrepancy with order, package, carga and ruta', () => {
    render(<DiscrepancyTable rows={ROWS} now={NOW} />);
    expect(screen.getByText('ORD-01')).toBeDefined();
    expect(screen.getByText('CTN-1')).toBeDefined();
    expect(screen.getByText('CARGA-EASY-001')).toBeDefined();
    expect(screen.getByText('PR-2026-2298')).toBeDefined();
  });

  it('labels the source operation in Spanish, per row — not just present somewhere', () => {
    // A same-string presence check ("Recepción" and "Recogida" both exist in
    // the document) would still pass if the two labels were swapped with
    // each other. Assert each row's OWN "Etapa" cell instead.
    render(<DiscrepancyTable rows={ROWS} now={NOW} />);
    expect(screen.getByTestId('discrepancy-stage-d-1').textContent).toBe('Recepción');
    expect(screen.getByTestId('discrepancy-stage-d-2').textContent).toBe('Recogida');
  });

  it('shows who closed the operation that detected it', () => {
    render(<DiscrepancyTable rows={ROWS} now={NOW} />);
    expect(screen.getByText('Ana Recepción')).toBeDefined();
    expect(screen.getByText('Beto Recogida')).toBeDefined();
  });

  it('computes "abierta hace" from detected_at and the injected now, not a hardcoded value', () => {
    render(<DiscrepancyTable rows={ROWS} now={NOW} />);
    // d-1 detected 2h before NOW (12:00 - 10:00); d-2 detected 24h before.
    expect(screen.getByTestId('discrepancy-since-d-1').textContent).toBe('2h');
    expect(screen.getByTestId('discrepancy-since-d-2').textContent).toBe('24h');
  });

  it('falls back to em-dash for missing order/package/carga/ruta/closer', () => {
    const barcodeOnly: DiscrepancyRow = {
      id: 'd-3', kind: 'unexpected', operation_type: 'pickup', status: 'open',
      detected_at: '2026-09-07T09:00:00Z', note: null,
      order_number: null, package_label: null, carga: null, ruta: null, closed_by_name: null,
    };
    render(<DiscrepancyTable rows={[barcodeOnly]} now={NOW} />);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(5);
  });
});

describe('computeDiscrepancyKpis', () => {
  it('counts total, pickup-source and reception-source rows', () => {
    const kpis = computeDiscrepancyKpis(ROWS);
    expect(kpis).toEqual([
      { label: 'Abiertas', value: '2' },
      { label: 'De recogida', value: '1' },
      { label: 'De recepción', value: '1' },
    ]);
  });

  // Unequal counts on purpose: a 1/1 split would still look correct even if
  // the pickup and reception filters were swapped with each other.
  it('does not confuse pickup-source with reception-source when the counts differ', () => {
    const skewed = [ROWS[0], ROWS[0], ROWS[1]];
    const kpis = computeDiscrepancyKpis(skewed);
    expect(kpis).toEqual([
      { label: 'Abiertas', value: '3' },
      { label: 'De recogida', value: '1' },
      { label: 'De recepción', value: '2' },
    ]);
  });

  it('returns zeroes for an empty list', () => {
    expect(computeDiscrepancyKpis([])).toEqual([
      { label: 'Abiertas', value: '0' },
      { label: 'De recogida', value: '0' },
      { label: 'De recepción', value: '0' },
    ]);
  });
});
