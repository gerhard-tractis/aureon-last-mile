import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PickupManifestTabs } from './PickupManifestTabs';
import type {
  PendingManifest, InTransitManifest, CompletedManifest,
} from '@/hooks/pickup/useManifests';

/**
 * `PickupManifestTabs` is the tab + filter half of /app/pickup, lifted out of
 * page.tsx (382 lines, over the 300-line limit). It is a PURE EXTRACTION, so
 * these tests pin the behaviours page.test.tsx already covered — tab labels,
 * the En tránsito badge and click target, the empty states — plus the two
 * things only the component can be asked directly: that the client filter and
 * the search term apply to ALL THREE tabs, not just Activos.
 */

const pending: PendingManifest[] = [
  {
    id: 'p1', external_load_id: 'CARGA-001', retailer_name: 'Easy',
    order_count: 5, package_count: 12, created_at: '2026-04-09T10:00:00Z',
    pickup_point: 'Bodega Norte', verified_count: 0,
    labels_printed_at: null, labels_printed_by_name: null,
  },
  {
    id: 'p2', external_load_id: 'CARGA-002', retailer_name: 'Sodimac',
    order_count: 3, package_count: 8, created_at: '2026-04-09T11:00:00Z',
    pickup_point: null, verified_count: 0,
    labels_printed_at: null, labels_printed_by_name: null,
  },
];

const inTransit: InTransitManifest[] = [
  {
    id: 'i1', external_load_id: 'CARGA-INT-1', retailer_name: 'Falabella',
    total_orders: 7, total_packages: 14, reception_status: 'awaiting_reception',
    updated_at: '2026-04-09T12:00:00Z', created_at: '2026-04-09T09:00:00Z',
    pickup_point: null, labels_printed_at: null, labels_printed_by_name: null,
  },
];

const completed: CompletedManifest[] = [
  {
    id: 'c1', external_load_id: 'CARGA-000', retailer_name: 'Easy',
    total_orders: 2, total_packages: 4, completed_at: '2026-04-09T13:00:00Z',
    created_at: '2026-04-09T08:00:00Z', pickup_point: null,
    labels_printed_at: null, labels_printed_by_name: null,
  },
];

const onManifestClick = vi.fn();
const onInTransitClick = vi.fn();
const onPrintLabels = vi.fn();

function renderTabs(overrides: Partial<React.ComponentProps<typeof PickupManifestTabs>> = {}) {
  return render(
    <PickupManifestTabs
      pending={pending}
      inTransit={inTransit}
      completed={completed}
      pendingLoading={false}
      inTransitLoading={false}
      completedLoading={false}
      selectedClient={null}
      searchTerm=""
      labelsEnabled={false}
      onManifestClick={onManifestClick}
      onInTransitClick={onInTransitClick}
      onPrintLabels={onPrintLabels}
      {...overrides}
    />,
  );
}

describe('PickupManifestTabs', () => {
  beforeEach(() => {
    onManifestClick.mockClear();
    onInTransitClick.mockClear();
    onPrintLabels.mockClear();
  });

  describe('Tabs', () => {
    it('renders the three tab triggers in Spanish, En tránsito in the middle', () => {
      renderTabs();
      const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
      expect(tabs).toEqual(['Activos', 'En tránsito', 'Completados']);
    });

    it('opens on Activos', () => {
      renderTabs();
      expect(screen.getByText('Easy')).toBeInTheDocument();
      expect(screen.getByText('Sodimac')).toBeInTheDocument();
    });
  });

  describe('En tránsito tab', () => {
    it('shows in-transit manifests with the "Pickup confirmado" badge', async () => {
      const user = userEvent.setup();
      renderTabs();
      await user.click(screen.getByRole('tab', { name: 'En tránsito' }));
      expect(screen.getByText('Falabella')).toBeInTheDocument();
      expect(screen.getByText('CARGA-INT-1')).toBeInTheDocument();
      expect(screen.getByText(/pickup confirmado/i)).toBeInTheDocument();
    });

    it('calls onInTransitClick with the load id when a card is clicked', async () => {
      const user = userEvent.setup();
      renderTabs();
      await user.click(screen.getByRole('tab', { name: 'En tránsito' }));
      const card = screen.getByText('Falabella').closest('[role="button"]') as HTMLElement;
      await user.click(card);
      expect(onInTransitClick).toHaveBeenCalledWith('CARGA-INT-1');
    });
  });

  describe('Activos tab', () => {
    it('passes the full card context to onManifestClick', async () => {
      const user = userEvent.setup();
      renderTabs();
      const card = screen.getByText('Easy').closest('[role="button"]') as HTMLElement;
      await user.click(card);
      expect(onManifestClick).toHaveBeenCalledWith('CARGA-001', 'Easy', 5, 12);
    });
  });

  describe('Empty states', () => {
    it('shows the pending empty state', () => {
      renderTabs({ pending: [] });
      expect(screen.getByText('Sin manifiestos pendientes')).toBeInTheDocument();
    });

    it('shows the in-transit empty state', async () => {
      const user = userEvent.setup();
      renderTabs({ inTransit: [] });
      await user.click(screen.getByRole('tab', { name: 'En tránsito' }));
      expect(screen.getByText('Sin manifiestos en tránsito')).toBeInTheDocument();
    });

    it('shows the completed empty state', async () => {
      const user = userEvent.setup();
      renderTabs({ completed: [] });
      await user.click(screen.getByRole('tab', { name: 'Completados' }));
      expect(screen.getByText('Sin manifiestos completados')).toBeInTheDocument();
    });

    it('tolerates undefined lists while the queries are in flight', () => {
      renderTabs({ pending: undefined, inTransit: undefined, completed: undefined });
      expect(screen.getByText('Sin manifiestos pendientes')).toBeInTheDocument();
    });
  });

  describe('Loading', () => {
    it('renders skeletons instead of the empty state while pending is loading', () => {
      const { container } = renderTabs({ pending: undefined, pendingLoading: true });
      expect(screen.queryByText('Sin manifiestos pendientes')).not.toBeInTheDocument();
      expect(container.querySelectorAll('.h-\\[72px\\]').length).toBe(3);
    });
  });

  describe('Filtering', () => {
    it('applies the client filter to Activos', () => {
      renderTabs({ selectedClient: 'Sodimac' });
      expect(screen.getByText('Sodimac')).toBeInTheDocument();
      expect(screen.queryByText('Easy')).not.toBeInTheDocument();
    });

    // The three tabs each ran the same filter chain in page.tsx. Asserted per
    // tab so the extraction cannot quietly drop it from one of them.
    it('applies the client filter to Completados too', async () => {
      const user = userEvent.setup();
      renderTabs({ selectedClient: 'Sodimac' });
      await user.click(screen.getByRole('tab', { name: 'Completados' }));
      expect(screen.getByText('Sin manifiestos completados')).toBeInTheDocument();
    });

    it('applies the client filter to En tránsito too', async () => {
      const user = userEvent.setup();
      renderTabs({ selectedClient: 'Easy' });
      await user.click(screen.getByRole('tab', { name: 'En tránsito' }));
      expect(screen.getByText('Sin manifiestos en tránsito')).toBeInTheDocument();
    });

    it('matches the search term against the load id, case-insensitively', () => {
      renderTabs({ searchTerm: 'carga-002' });
      expect(screen.getByText('Sodimac')).toBeInTheDocument();
      expect(screen.queryByText('Easy')).not.toBeInTheDocument();
    });

    it('matches the search term against the retailer name', () => {
      renderTabs({ searchTerm: 'sodi' });
      expect(screen.getByText('Sodimac')).toBeInTheDocument();
      expect(screen.queryByText('Easy')).not.toBeInTheDocument();
    });

    it('matches the search term against the pickup point', () => {
      renderTabs({ searchTerm: 'bodega norte' });
      expect(screen.getByText('Easy')).toBeInTheDocument();
      expect(screen.queryByText('Sodimac')).not.toBeInTheDocument();
    });

    it('treats a whitespace-only search term as no filter', () => {
      renderTabs({ searchTerm: '   ' });
      expect(screen.getByText('Easy')).toBeInTheDocument();
      expect(screen.getByText('Sodimac')).toBeInTheDocument();
    });
  });

  describe('Label printing (spec-53)', () => {
    it('hides the print button when the module is off', () => {
      renderTabs();
      expect(
        screen.queryByRole('button', { name: 'Imprimir etiquetas' }),
      ).not.toBeInTheDocument();
    });

    it('calls onPrintLabels with the manifest id when the module is on', async () => {
      const user = userEvent.setup();
      renderTabs({ labelsEnabled: true });
      // Exact name, not /etiquetas/i: the ManifestCard wrapper is itself
      // role="button" and takes its accessible name from its contents, so a
      // substring matcher hits the card before the print button inside it.
      const buttons = screen.getAllByRole('button', { name: 'Imprimir etiquetas' });
      await user.click(buttons[0]);
      expect(onPrintLabels).toHaveBeenCalledWith('p1');
      expect(onManifestClick).not.toHaveBeenCalled();
    });
  });
});
