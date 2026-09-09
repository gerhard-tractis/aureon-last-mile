import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TodayClosuresPanel } from './TodayClosuresPanel';
import type { CompletedManifest } from '@/hooks/pickup/useManifests';

/**
 * spec-83 fase 1 — "Cierres de hoy" now shows merma ("N faltantes de M") in
 * the warning palette, sourced from get_completed_manifests' missing_count
 * (spec-85 discrepancies). A clean close keeps the plain "M paquetes" line
 * and the success palette it already had (spec-54 phase 4.4).
 */

function completedManifest(over: Partial<CompletedManifest> = {}): CompletedManifest {
  return {
    id: 'c1',
    external_load_id: 'CARGA-99785',
    retailer_name: 'Ripley',
    total_orders: 14,
    total_packages: 44,
    completed_at: '2026-09-08T13:12:00Z',
    created_at: '2026-09-08T08:00:00Z',
    pickup_point: 'Mall Plaza Vespucio',
    labels_printed_at: null,
    labels_printed_by_name: null,
    missing_count: 0,
    ...over,
  };
}

describe('TodayClosuresPanel', () => {
  it('shows the missing-packages line in the warning palette when missing_count > 0', () => {
    render(<TodayClosuresPanel rows={[completedManifest({ missing_count: 2 })]} />);

    const row = screen.getByTestId('closure-row');
    expect(screen.getByText('2 faltantes de 44')).toBeInTheDocument();
    expect(row.className).toContain('status-warning');
  });

  it('does NOT use the warning palette on a clean close (missing_count = 0)', () => {
    render(<TodayClosuresPanel rows={[completedManifest({ missing_count: 0 })]} />);

    const row = screen.getByTestId('closure-row');
    expect(screen.queryByText(/faltantes de/)).not.toBeInTheDocument();
    expect(screen.getByText(/44 paquetes/)).toBeInTheDocument();
    expect(row.className).not.toContain('status-warning');
  });

  // Round-2 review finding: "1 faltantes de 44" reads wrong to the warehouse
  // lead who has to act on this line. Singular/plural must actually agree.
  it('uses the singular "faltante" (not "faltantes") when missing_count is exactly 1', () => {
    render(<TodayClosuresPanel rows={[completedManifest({ missing_count: 1 })]} />);

    expect(screen.getByText('1 faltante de 44')).toBeInTheDocument();
    expect(screen.queryByText(/1 faltantes/)).not.toBeInTheDocument();
  });

  it('keeps the plural "faltantes" when missing_count is 2 or more', () => {
    render(<TodayClosuresPanel rows={[completedManifest({ missing_count: 2 })]} />);

    expect(screen.getByText('2 faltantes de 44')).toBeInTheDocument();
  });
});
