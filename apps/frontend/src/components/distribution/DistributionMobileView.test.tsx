import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DistributionMobileView, type DistributionMobileViewProps } from './DistributionMobileView';
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

describe('DistributionMobileView (4c)', () => {
  it('renders the greeting header', () => {
    render(<DistributionMobileView {...baseProps} />);
    expect(screen.getByText('Hola, Marcela')).toBeInTheDocument();
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

  it('renders the three PROCESOS DE LA NAVE rows linking to their eventual routes', () => {
    render(<DistributionMobileView {...baseProps} />);
    expect(screen.getByText('PROCESOS DE LA NAVE')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /pendientes de sectorizar/i })).toHaveAttribute(
      'href',
      '/app/distribution/pendientes',
    );
    expect(screen.getByRole('link', { name: /consolidaci/i })).toHaveAttribute(
      'href',
      '/app/distribution/consolidacion',
    );
    expect(screen.getByRole('link', { name: /andenes/i })).toHaveAttribute(
      'href',
      '/app/distribution/andenes',
    );
  });

  it('every process row meets the 60px touch floor', () => {
    render(<DistributionMobileView {...baseProps} />);
    for (const name of [/pendientes de sectorizar/i, /consolidaci/i, /andenes/i]) {
      const link = screen.getByRole('link', { name });
      expect(link.className).toMatch(/min-h-\[?(6\d|[7-9]\d)/);
    }
  });

  it('process rows show the counts they link to', () => {
    render(<DistributionMobileView {...baseProps} />);
    expect(screen.getByRole('link', { name: /pendientes de sectorizar/i })).toHaveTextContent('12');
    expect(screen.getByRole('link', { name: /consolidaci/i })).toHaveTextContent('4');
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
