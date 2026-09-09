import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TodayClosuresPanel } from './TodayClosuresPanel';
import type { CompletedManifest } from '@/hooks/pickup/useManifests';

/**
 * spec-83 fase 1 — "Cierres de hoy" shows merma ("N faltantes de M") in the
 * warning palette, sourced from get_completed_manifests' missing_count
 * (spec-85 discrepancies). A clean close keeps the success palette.
 *
 * spec-83 fase 4 (round 2 review) — `5a` (docs/design/Recogida.dc.html:266,
 * 261) puts the retailer name on BOTH lines ("Ripley · 2 faltantes de 44",
 * "Falabella · 38/38 paquetes"), and the clean line is a verified/total
 * ratio, not a bare count. Neither survived the first pass of this phase.
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
    expect(row.textContent).toContain('2 faltantes de 44');
    expect(row.className).toContain('status-warning');
  });

  // Round-2 review finding: the mock (`5a`, line 266) reads "Ripley · 2
  // faltantes de 44" — the retailer was missing from this line entirely.
  it('includes the retailer name on the missing-packages line, like the clean line already did', () => {
    render(
      <TodayClosuresPanel
        rows={[completedManifest({ retailer_name: 'Ripley', missing_count: 2, total_packages: 44 })]}
      />,
    );

    const row = screen.getByTestId('closure-row');
    expect(row.textContent).toContain('Ripley · 2 faltantes de 44');
  });

  it('falls back to "Sin cliente" on the missing-packages line when retailer_name is null', () => {
    render(
      <TodayClosuresPanel
        rows={[completedManifest({ retailer_name: null, missing_count: 2, total_packages: 44 })]}
      />,
    );

    const row = screen.getByTestId('closure-row');
    expect(row.textContent).toContain('Sin cliente · 2 faltantes de 44');
  });

  it('does NOT use the warning palette on a clean close (missing_count = 0)', () => {
    render(<TodayClosuresPanel rows={[completedManifest({ missing_count: 0 })]} />);

    const row = screen.getByTestId('closure-row');
    expect(row.textContent).not.toMatch(/faltantes de/);
    expect(row.className).not.toContain('status-warning');
  });

  // Round-2 review finding: `5a` (lines 261, 271, 276) shows a verified/total
  // ratio on a clean close ("38/38 paquetes"), not a bare total. missing_count
  // is 0 on a clean row, so verified === total, but the shape has to be the
  // ratio — a bare "38 paquetes" would silently stop matching the mock the
  // day a clean-but-partially-verified state exists.
  it('shows a verified/total ratio on a clean close, matching the mock', () => {
    render(
      <TodayClosuresPanel
        rows={[completedManifest({ retailer_name: 'Falabella', missing_count: 0, total_packages: 38 })]}
      />,
    );

    const row = screen.getByTestId('closure-row');
    expect(row.textContent).toContain('Falabella · 38/38 paquetes');
  });

  // Round-2 review finding: "1 faltantes de 44" reads wrong to the warehouse
  // lead who has to act on this line. Singular/plural must actually agree.
  it('uses the singular "faltante" (not "faltantes") when missing_count is exactly 1', () => {
    render(<TodayClosuresPanel rows={[completedManifest({ missing_count: 1 })]} />);

    const row = screen.getByTestId('closure-row');
    expect(row.textContent).toContain('1 faltante de 44');
    expect(row.textContent).not.toMatch(/1 faltantes/);
  });

  it('keeps the plural "faltantes" when missing_count is 2 or more', () => {
    render(<TodayClosuresPanel rows={[completedManifest({ missing_count: 2 })]} />);

    expect(screen.getByTestId('closure-row').textContent).toContain('2 faltantes de 44');
  });

  // spec-83 fase 4 — diff visual: spec-54's `?? 0` made a manifest with no
  // package count read "2 faltantes de 0", which reads as if nothing was
  // ever expected. Omit the "de M" clause entirely when the total is
  // unknown rather than lying with a zero.
  it('omits "de M" on the missing line when total_packages is null, instead of showing "de 0"', () => {
    render(
      <TodayClosuresPanel rows={[completedManifest({ missing_count: 2, total_packages: null })]} />,
    );

    const row = screen.getByTestId('closure-row');
    expect(row.textContent).toContain('2 faltantes');
    expect(row.textContent).not.toMatch(/de 0/);
  });

  // Round-2 review finding: the fix above only touched the missing branch.
  // The clean branch had the exact same `?? 0`, eight lines down, and the
  // fase-1 note describing it as a known nit was only half true afterwards.
  it('omits the packages clause on a clean close when total_packages is null, instead of showing "0 paquetes"', () => {
    render(
      <TodayClosuresPanel
        rows={[completedManifest({ retailer_name: 'Ripley', missing_count: 0, total_packages: null })]}
      />,
    );

    const row = screen.getByTestId('closure-row');
    expect(row.textContent).not.toMatch(/de 0|0 paquetes|0\/0/);
    expect(row.textContent).toContain('Ripley');
  });
});
