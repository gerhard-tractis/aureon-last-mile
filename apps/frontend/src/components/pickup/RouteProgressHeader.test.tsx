import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { RouteProgressHeader } from './RouteProgressHeader';
import type { RouteManifestRow } from './RouteManifestList';

function manifest(overrides: Partial<RouteManifestRow> = {}): RouteManifestRow {
  return {
    id: 'm1',
    external_load_id: 'LOAD-1',
    retailer_name: 'A',
    pickup_location: null,
    total_orders: 2,
    total_packages: 8,
    verified_count: 6,
    ...overrides,
  };
}

describe('RouteProgressHeader', () => {
  const route = {
    code: 'PR-2026-0001',
    started_at: '2026-08-17T13:05:00.000Z',
    vehicle: { plate: 'AAA-111' },
  };

  it('renders the route code and vehicle plate', () => {
    render(<RouteProgressHeader route={route} manifests={[manifest()]} />);
    expect(screen.getByText('PR-2026-0001')).toBeInTheDocument();
    expect(screen.getByText(/AAA-111/)).toBeInTheDocument();
  });

  it('restores the departure DATE alongside the time — a route left open overnight must not look same-day', () => {
    render(<RouteProgressHeader route={route} manifests={[manifest()]} />);
    // 2026-08-17T13:05:00Z formatted in the "DD-MM HH:MM" header style.
    expect(screen.getByTestId('route-progress-header').textContent).toMatch(/17-08/);
  });

  it('shows the verified/expected count in mono format when the total is fully known', () => {
    render(
      <RouteProgressHeader
        route={route}
        manifests={[manifest({ total_packages: 24, verified_count: 18 })]}
      />,
    );
    expect(screen.getByText('18/24')).toBeInTheDocument();
  });

  it('renders VERIFICADOS, RESTAN and MANIFIESTOS metrics — no FALLIDAS or CIERRE EST', () => {
    render(
      <RouteProgressHeader
        route={route}
        manifests={[manifest({ total_packages: 24, verified_count: 18 })]}
      />,
    );
    const verificados = screen.getByTestId('metric-verificados');
    const restan = screen.getByTestId('metric-restan');
    const manifiestos = screen.getByTestId('metric-manifiestos');
    expect(within(verificados).getByText('VERIFICADOS')).toBeInTheDocument();
    expect(within(verificados).getByText('18')).toBeInTheDocument();
    expect(within(restan).getByText('RESTAN')).toBeInTheDocument();
    expect(within(restan).getByText('6')).toBeInTheDocument(); // 24 - 18
    expect(within(manifiestos).getByText('MANIFIESTOS')).toBeInTheDocument();
    expect(within(manifiestos).getByText('1')).toBeInTheDocument();
    expect(screen.queryByText(/FALLIDAS/)).toBeNull();
    expect(screen.queryByText(/CIERRE/)).toBeNull();
  });

  it('never renders a "restan" below zero when verified exceeds expected', () => {
    render(
      <RouteProgressHeader
        route={route}
        manifests={[manifest({ total_packages: 24, verified_count: 25 })]}
      />,
    );
    expect(within(screen.getByTestId('metric-restan')).getByText('0')).toBeInTheDocument();
  });

  // spec-54 phase 4.6 fix: total_packages is nullable — reading it as 0
  // produced a fabricated "5/0" (>100%) denominator.
  it('shows the denominator and RESTAN as an em dash — never a fabricated total — when any manifest total is unknown', () => {
    render(
      <RouteProgressHeader
        route={route}
        manifests={[
          manifest({ total_packages: 8, verified_count: 6 }),
          manifest({ id: 'm2', total_packages: null, verified_count: 0 }),
        ]}
      />,
    );
    expect(screen.getByText('6/—')).toBeInTheDocument();
    expect(within(screen.getByTestId('metric-restan')).getByText('—')).toBeInTheDocument();
    expect(screen.getByText(/total pendiente de definir/i)).toBeInTheDocument();
  });

  it('does not render the stacked progress bar when the denominator is unknown', () => {
    render(
      <RouteProgressHeader
        route={route}
        manifests={[manifest({ total_packages: null, verified_count: 0 })]}
      />,
    );
    expect(screen.queryByRole('img', { name: /progreso/i })).toBeNull();
  });

  it('does not render an SLA badge — no SLA data exists on pickup_routes', () => {
    render(<RouteProgressHeader route={route} manifests={[manifest()]} />);
    expect(screen.queryByText(/SLA/)).toBeNull();
  });

  // spec-54 phase 4.6 fix (review round 2): the page previously rendered
  // this header above the manifests-loading gate, defaulting `manifests` to
  // `[]` — `sumExpected([])` returns `{0, false}`, so the unknown-total path
  // never fired and a 40-package route flashed a fabricated "0/0" with a
  // rendered (empty) bar while still loading.
  it('shows a loading state instead of a fabricated 0/0 while manifests are still loading', () => {
    render(<RouteProgressHeader route={route} manifests={[]} isLoading />);
    expect(screen.queryByText('0/0')).toBeNull();
    expect(screen.queryByRole('img', { name: /progreso/i })).toBeNull();
    expect(screen.getByText(/cargando manifiestos/i)).toBeInTheDocument();
    // The route identity is already loaded independently of the manifests
    // query — no reason to hide it while manifests load.
    expect(screen.getByText('PR-2026-0001')).toBeInTheDocument();
  });

  it('exposes the verified/total counts to screen readers, not only via the bar\'s title attribute', () => {
    render(
      <RouteProgressHeader
        route={route}
        manifests={[manifest({ total_packages: 24, verified_count: 18 })]}
      />,
    );
    expect(screen.getByText(/18 de 24 paquetes verificados/i)).toBeInTheDocument();
  });
});
