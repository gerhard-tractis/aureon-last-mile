import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PickupMobileCompactRow } from './PickupMobileCompactRow';
import type { RouteManifestRow } from './RouteManifestList';

function byFullText(text: string) {
  return (_content: string, node: Element | null) => node?.textContent === text;
}

function manifest(overrides: Partial<RouteManifestRow> = {}): RouteManifestRow {
  return {
    id: 'm1',
    external_load_id: 'CARGA-99820',
    retailer_name: 'Falabella',
    pickup_location: 'Mall Sport',
    total_orders: 9,
    total_packages: 25,
    verified_count: 0,
    status: 'pending',
    ...overrides,
  };
}

describe('PickupMobileCompactRow — remaining', () => {
  it('shows the pickup point name and a code · packages · orders secondary line', () => {
    render(<PickupMobileCompactRow variant="remaining" manifest={manifest()} onOpen={vi.fn()} />);
    expect(screen.getByText('Mall Sport')).toBeInTheDocument();
    expect(
      screen.getByText(byFullText('CARGA-99820 · 25 paquetes · 9 órdenes')),
    ).toBeInTheDocument();
  });

  it('opens the manifest on tap', async () => {
    const onOpen = vi.fn();
    render(<PickupMobileCompactRow variant="remaining" manifest={manifest()} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('is at least 44px tall for touch', () => {
    render(<PickupMobileCompactRow variant="remaining" manifest={manifest()} onOpen={vi.fn()} />);
    expect(screen.getByRole('button').className).toMatch(/min-h-\[(4[4-9]|[5-9]\d)px\]/);
  });
});

describe('PickupMobileCompactRow — completed', () => {
  it('shows COMPLETADA and a code · notas · cerrada line', () => {
    render(
      <PickupMobileCompactRow
        variant="completed"
        manifest={manifest({
          external_load_id: 'CARGA-99808',
          status: 'completed',
          completed_at: new Date('2026-08-13T07:31:00').toISOString(),
          discrepancy_count: 0,
        })}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('COMPLETADA')).toBeInTheDocument();
    expect(
      screen.getByText(byFullText('CARGA-99808 · 0 notas · cerrada 07:31')),
    ).toBeInTheDocument();
  });

  it('omits the closed time when completed_at is unavailable', () => {
    render(
      <PickupMobileCompactRow
        variant="completed"
        manifest={manifest({
          external_load_id: 'CARGA-99808',
          status: 'completed',
          completed_at: null,
          discrepancy_count: 2,
        })}
        onOpen={vi.fn()}
      />,
    );
    expect(
      screen.getByText(byFullText('CARGA-99808 · 2 notas')),
    ).toBeInTheDocument();
  });

  // Review round 2 item 6 — discrepancy_count is optional on the shared
  // RouteManifestRow type; a caller that never fetched it must not have
  // "0 notas" fabricated for it (that would claim "checked, no issues"
  // rather than "we don't know").
  it('renders — for notas when discrepancy_count is not fetched by the caller', () => {
    render(
      <PickupMobileCompactRow
        variant="completed"
        manifest={manifest({
          external_load_id: 'CARGA-99808',
          status: 'completed',
          completed_at: null,
          discrepancy_count: undefined,
        })}
        onOpen={vi.fn()}
      />,
    );
    expect(
      screen.getByText(byFullText('CARGA-99808 · — notas')),
    ).toBeInTheDocument();
  });
});
