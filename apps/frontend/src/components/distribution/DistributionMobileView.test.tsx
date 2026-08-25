import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  DistributionMobileView,
  todayISOFrom,
  type DistributionMobileViewProps,
} from './DistributionMobileView';
import type { DistributionKPIs } from '@/hooks/distribution/useDistributionKPIs';
import type { ConsolidationPackage } from '@/hooks/distribution/useConsolidation';
import type { UnmatchedComunaRow } from '@/hooks/distribution/useUnmatchedComunas';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const kpis: DistributionKPIs = { pending: 12, consolidation: 4, dueSoon: 2 };

function pkg(overrides: Partial<ConsolidationPackage> = {}): ConsolidationPackage {
  return {
    id: 'pkg-1',
    label: 'BULTO-1',
    dock_zone_id: null,
    order_id: 'order-1',
    delivery_date: '2026-08-24',
    ...overrides,
  };
}

const baseProps: DistributionMobileViewProps = {
  userName: 'Marcela Rojas',
  kpis,
  consolidationPackages: [],
  unmatchedComunas: [],
  isLoading: false,
  now: new Date('2026-08-24T12:00:00.000Z'),
};

describe('todayISOFrom', () => {
  // Review fix (finding 3) — regression guard for the UTC-date bug. This
  // instant is 2026-08-25T01:00:00Z: already "tomorrow" in UTC, but still
  // the evening of 2026-08-24 in America/Santiago (UTC-3/-4). The old
  // now.toISOString().split('T')[0] implementation would have returned
  // '2026-08-25' here.
  it('reads the Santiago civil date, not the UTC date', () => {
    expect(todayISOFrom(new Date('2026-08-25T01:00:00.000Z'))).toBe('2026-08-24');
  });

  it('matches the UTC date away from the day boundary, so the common case is unaffected', () => {
    expect(todayISOFrom(new Date('2026-08-24T15:00:00.000Z'))).toBe('2026-08-24');
  });
});

describe('DistributionMobileView (4c)', () => {
  it('renders the greeting header', () => {
    render(<DistributionMobileView {...baseProps} />);
    expect(screen.getByText('Hola, Marcela')).toBeInTheDocument();
  });

  it('carries a top-level heading for the route (finding 7 — mobile had none)', () => {
    render(<DistributionMobileView {...baseProps} />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('the hero task card headlines the pending count and links to quicksort', () => {
    render(<DistributionMobileView {...baseProps} />);
    expect(screen.getByText('TU TAREA AHORA')).toBeInTheDocument();
    expect(screen.getByText('12 paquetes sin sectorizar')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /escanear y clasificar/i });
    expect(link).toHaveAttribute('href', '/app/distribution/quicksort');
  });

  it('singularizes the hero headline for exactly one pending package', () => {
    render(<DistributionMobileView {...baseProps} kpis={{ ...kpis, pending: 1 }} />);
    expect(screen.getByText('1 paquete sin sectorizar')).toBeInTheDocument();
  });

  it('the primary button meets the 56px floor for gloved use', () => {
    render(<DistributionMobileView {...baseProps} />);
    const link = screen.getByRole('link', { name: /escanear y clasificar/i });
    expect(link.className).toMatch(/min-h-\[?(5[6-9]|[6-9]\d)/);
  });

  it('shows three KPI tiles: pendientes, consolidación, salen ya', () => {
    render(<DistributionMobileView {...baseProps} />);
    const tiles = screen.getAllByTestId('stat-tile');
    expect(tiles).toHaveLength(3);
    expect(tiles[0]).toHaveTextContent('12');
    expect(tiles[1]).toHaveTextContent('4');
  });

  it('computes SALEN YA client-side from consolidation packages due today or tomorrow', () => {
    render(
      <DistributionMobileView
        {...baseProps}
        consolidationPackages={[
          pkg({ id: 'a', delivery_date: '2026-08-24' }), // hoy
          pkg({ id: 'b', delivery_date: '2026-08-25' }), // mañana
          pkg({ id: 'c', delivery_date: '2026-09-01' }), // later — excluded
        ]}
      />,
    );
    const tiles = screen.getAllByTestId('stat-tile');
    const salenYa = tiles.find((t) => t.textContent?.includes('Salen ya'))!;
    expect(salenYa).toHaveTextContent('2');
  });

  // Review fix (finding 5) — overdue packages must count too: excluding
  // them made a consolidation zone holding only late packages read
  // "Salen ya: 0", the opposite of the truth.
  it('also counts overdue packages in SALEN YA', () => {
    render(
      <DistributionMobileView
        {...baseProps}
        consolidationPackages={[
          pkg({ id: 'a', delivery_date: '2026-08-20' }), // overdue
          pkg({ id: 'b', delivery_date: '2026-09-01' }), // later — excluded
        ]}
      />,
    );
    const tiles = screen.getAllByTestId('stat-tile');
    const salenYa = tiles.find((t) => t.textContent?.includes('Salen ya'))!;
    expect(salenYa).toHaveTextContent('1');
  });

  // Review fix (finding 3) — isolates the timezone bug from the overdue
  // fix above. At this instant Santiago is still on 2026-08-24 evening
  // while UTC already reads 2026-08-25. A package due 2026-08-26 is two
  // days out from the TRUE (Santiago) today, so it must NOT count. The old
  // UTC-based todayISOFrom would have read today as '2026-08-25' and
  // wrongly counted this package as "mañana".
  it('does not miscount a day-after-tomorrow package during the Chile evening UTC-date rollover', () => {
    render(
      <DistributionMobileView
        {...baseProps}
        now={new Date('2026-08-25T01:00:00.000Z')}
        consolidationPackages={[pkg({ id: 'a', delivery_date: '2026-08-26' })]}
      />,
    );
    const tiles = screen.getAllByTestId('stat-tile');
    const salenYa = tiles.find((t) => t.textContent?.includes('Salen ya'))!;
    expect(salenYa).toHaveTextContent('0');
  });

  // spec-68 Fase 6 — /app/distribution/andenes ships this phase, so
  // Andenes moves from inert to a real link: the last of the three rows,
  // and the "still inert" group this test used to describe is now empty.
  it('Andenes is a real link now that /andenes exists', () => {
    render(<DistributionMobileView {...baseProps} />);
    expect(screen.getByText('PROCESOS DE LA NAVE')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /andenes/i });
    expect(link).toHaveAttribute('href', '/app/distribution/andenes');
    expect(screen.getByTestId('process-row-andenes')).not.toHaveAttribute('aria-disabled');
  });

  // spec-68 Fase 3 — /app/distribution/pendientes ships this phase, so its
  // row is the first of the three to go live.
  it('Pendientes de sectorizar is a real link now that /pendientes exists', () => {
    render(<DistributionMobileView {...baseProps} />);
    const link = screen.getByRole('link', { name: /pendientes de sectorizar/i });
    expect(link).toHaveAttribute('href', '/app/distribution/pendientes');
    expect(screen.getByTestId('process-row-pendientes')).not.toHaveAttribute('aria-disabled');
  });

  // spec-68 Fase 4 — /app/distribution/consolidacion ships this phase, so
  // its row moves from inert to a real link, same as pendientes did.
  it('Consolidación is a real link now that /consolidacion exists', () => {
    render(<DistributionMobileView {...baseProps} />);
    const link = screen.getByRole('link', { name: /consolidaci/i });
    expect(link).toHaveAttribute('href', '/app/distribution/consolidacion');
    expect(screen.getByTestId('process-row-consolidacion')).not.toHaveAttribute('aria-disabled');
  });

  it('every process row meets the 60px touch floor', () => {
    render(<DistributionMobileView {...baseProps} />);
    for (const testId of ['process-row-pendientes', 'process-row-consolidacion', 'process-row-andenes']) {
      const row = screen.getByTestId(testId);
      expect(row.className).toMatch(/min-h-\[?(6\d|[7-9]\d)/);
    }
  });

  it('process rows show the counts even though they are not navigable yet', () => {
    render(<DistributionMobileView {...baseProps} />);
    expect(screen.getByTestId('process-row-pendientes')).toHaveTextContent('12');
    expect(screen.getByTestId('process-row-consolidacion')).toHaveTextContent('4');
  });

  // Review fix (finding 6) — Consolidación and Andenes must not share a
  // glyph; with gloves on, the icon is the fastest discriminator.
  it('gives Consolidación and Andenes visually distinct icons', () => {
    render(<DistributionMobileView {...baseProps} />);
    const consolidacionIcon = screen.getByTestId('process-row-consolidacion').querySelector('svg')!;
    const andenesIcon = screen.getByTestId('process-row-andenes').querySelector('svg')!;
    expect(consolidacionIcon.getAttribute('class')).not.toBe(andenesIcon.getAttribute('class'));
  });

  it('shows the unmatched-comunas warning banner only when there is at least one', () => {
    const unmatched: UnmatchedComunaRow[] = [{ comuna_raw: 'Colina', order_count: 3 }];
    render(<DistributionMobileView {...baseProps} unmatchedComunas={unmatched} />);
    expect(screen.getByText('1 comuna sin andén asignado')).toBeInTheDocument();
  });

  it('pluralises the unmatched-comunas banner copy', () => {
    const unmatched: UnmatchedComunaRow[] = [
      { comuna_raw: 'Colina', order_count: 3 },
      { comuna_raw: 'Til Til', order_count: 1 },
    ];
    render(<DistributionMobileView {...baseProps} unmatchedComunas={unmatched} />);
    expect(screen.getByText('2 comunas sin andén asignado')).toBeInTheDocument();
  });

  it('omits the banner entirely when there are no unmatched comunas', () => {
    render(<DistributionMobileView {...baseProps} unmatchedComunas={[]} />);
    expect(screen.queryByText(/sin andén asignado/i)).not.toBeInTheDocument();
  });

  it('does not mount the desktop KPI grid, ActiveSortersPanel or ConsolidationPanel', () => {
    // Decisión 1 — the mobile tree does not render the sitting floor-lead's
    // screen at all, not even hidden.
    render(<DistributionMobileView {...baseProps} />);
    expect(screen.queryByText('Andenes de salida')).not.toBeInTheDocument();
    expect(screen.queryByText('Operarios activos')).not.toBeInTheDocument();
    expect(screen.queryByText('Sin paquetes en consolidación')).not.toBeInTheDocument();
  });

  it('does not render its own bottom tab bar — the global MobileTabBar wins', () => {
    render(<DistributionMobileView {...baseProps} />);
    expect(screen.queryByText(/^Hoy$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Clasificar$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Perfil$/)).not.toBeInTheDocument();
  });

  it('while loading shows skeletons rather than a spinner, without crashing on missing data', () => {
    render(<DistributionMobileView {...baseProps} isLoading kpis={undefined} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByTestId('distribution-mobile-hero-skeleton')).toBeInTheDocument();
  });
});
