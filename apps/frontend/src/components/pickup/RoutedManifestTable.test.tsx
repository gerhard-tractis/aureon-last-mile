import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RoutedManifestTable } from './RoutedManifestTable';
import type { RoutedManifest } from '@/hooks/pickup/useRoutedManifests';

const NOW = new Date('2026-09-10T12:00:00Z');

function makeRow(overrides: Partial<RoutedManifest> = {}): RoutedManifest {
  return {
    id: 'm1',
    external_load_id: 'CARGA-94-DOCK',
    retailer_name: 'Easy',
    total_orders: 5,
    total_packages: 12,
    created_at: '2026-09-10T08:00:00Z',
    pickup_point: 'Easy Vespucio',
    labels_printed_at: null,
    labels_printed_by_name: null,
    route_code: 'PR-2026-0042',
    route_started_at: '2026-09-10T10:00:00Z',
    driver_name: 'Juan Pérez',
    route_status: 'in_progress',
    closed_at: null,
    missing_count: 0,
    verified_count: 3,
    ...overrides,
  };
}

describe('RoutedManifestTable', () => {
  it('shows the empty message when there are no rows', () => {
    render(<RoutedManifestTable rows={[]} emptyMessage="Ninguna carga en ruta." now={NOW} />);
    expect(screen.getByText('Ninguna carga en ruta.')).toBeInTheDocument();
  });

  it('renders the load, route, driver and package count', () => {
    render(<RoutedManifestTable rows={[makeRow()]} emptyMessage="—" now={NOW} />);
    expect(screen.getByText('CARGA-94-DOCK')).toBeInTheDocument();
    expect(screen.getByText('PR-2026-0042')).toBeInTheDocument();
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('shows "abierta hace" as elapsed time since route_started_at', () => {
    render(<RoutedManifestTable rows={[makeRow()]} emptyMessage="—" now={NOW} />);
    // route_started_at 10:00, now 12:00 -> 2h 0m.
    expect(screen.getByText('2h 0m')).toBeInTheDocument();
  });

  it('shows no closed chip while the load is still being scanned', () => {
    render(<RoutedManifestTable rows={[makeRow({ closed_at: null })]} emptyMessage="—" now={NOW} />);
    expect(screen.queryByTestId('closed-chip')).not.toBeInTheDocument();
  });

  it('shows a success-toned chip on a clean close', () => {
    render(
      <RoutedManifestTable
        rows={[makeRow({ closed_at: '2026-09-10T09:00:00Z', missing_count: 0 })]}
        emptyMessage="—"
        now={NOW}
      />,
    );
    const chip = screen.getByTestId('closed-chip');
    // Time-of-day text is locale/TZ-dependent in this test environment
    // (matches the repo's existing convention — TodayClosuresPanel.test.tsx
    // does not assert the literal HH:MM either); assert the "cerrada"
    // prefix and the tone, not the exact clock text.
    expect(chip).toHaveTextContent(/^cerrada/);
    expect(chip.className).toContain('status-success');
  });

  it('shows a warning-toned chip with the missing count on a close with discrepancies', () => {
    render(
      <RoutedManifestTable
        rows={[makeRow({ closed_at: '2026-09-10T09:00:00Z', missing_count: 3 })]}
        emptyMessage="—"
        now={NOW}
      />,
    );
    const chip = screen.getByTestId('closed-chip');
    expect(chip).toHaveTextContent(/^cerrada/);
    expect(chip).toHaveTextContent('3 faltantes');
    expect(chip.className).toContain('status-warning');
  });

  // ronda 4 (review fase 2) — the row also carries "—" in other cells
  // (empty-message fallback shape, closed-chip absence), so asserting on
  // the whole row would pass even if the driver cell rendered something
  // else entirely. Assert on the driver cell specifically.
  it('renders a placeholder for a route with no resolvable driver', () => {
    render(<RoutedManifestTable rows={[makeRow({ driver_name: null })]} emptyMessage="—" now={NOW} />);
    expect(screen.getByTestId('driver-name')).toHaveTextContent('—');
  });
});
