import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { DockListMobile } from './DockListMobile';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';

const zoneA: DockZoneRecord = {
  id: 'zone-a1',
  name: 'Zona Norte',
  code: 'A1',
  is_consolidation: false,
  is_active: true,
  comunas: [{ id: 'c-1', nombre: 'Quilicura' }],
  operator_id: 'op-1',
  capacity: 180,
};

const zoneB: DockZoneRecord = {
  id: 'zone-b1',
  name: 'Zona Sur',
  code: 'B1',
  is_consolidation: false,
  is_active: true,
  comunas: [{ id: 'c-2', nombre: 'Puente Alto' }],
  operator_id: 'op-1',
  capacity: null,
};

const inactiveZone: DockZoneRecord = {
  id: 'zone-c1',
  name: 'Zona Oeste',
  code: 'C1',
  is_consolidation: false,
  is_active: false,
  comunas: [],
  operator_id: 'op-1',
  capacity: 50,
};

const consZone: DockZoneRecord = {
  id: 'zone-cons',
  name: 'Consolidación',
  code: 'CONS',
  is_consolidation: true,
  is_active: true,
  comunas: [],
  operator_id: 'op-1',
  capacity: null,
};

// Review round 1 (finding #4) — capacity: 0 has no CHECK constraint
// preventing it, and getDockCapacityStatus treats it the same as null.
// Hand-derived `capacity != null && capacity > 0` checks miss this unless
// the `> 0` half is present; a fixture forces that half to be exercised.
const zoneZeroCapacity: DockZoneRecord = {
  id: 'zone-zero',
  name: 'Zona Cero',
  code: 'Z0',
  is_consolidation: false,
  is_active: true,
  comunas: [{ id: 'c-3', nombre: 'Renca' }],
  operator_id: 'op-1',
  capacity: 0,
};

describe('DockListMobile', () => {
  it('renders one row per active andén, with code, zone name and count', () => {
    render(
      <DockListMobile
        zones={[zoneA, zoneB]}
        sectorizedCounts={{ 'zone-a1': 169, 'zone-b1': 4 }}
      />,
    );

    const rowA = screen.getByTestId('dock-list-row-zone-a1');
    expect(within(rowA).getByText('A1')).toBeInTheDocument();
    expect(within(rowA).getByText('Zona Norte')).toBeInTheDocument();
    expect(within(rowA).getByText('169')).toBeInTheDocument();

    const rowB = screen.getByTestId('dock-list-row-zone-b1');
    expect(within(rowB).getByText('B1')).toBeInTheDocument();
    expect(within(rowB).getByText('4')).toBeInTheDocument();
  });

  it('omits inactive zones', () => {
    render(<DockListMobile zones={[zoneA, inactiveZone]} sectorizedCounts={{}} />);
    expect(screen.queryByTestId('dock-list-row-zone-c1')).not.toBeInTheDocument();
  });

  it('includes the consolidation zone, marked as such', () => {
    render(<DockListMobile zones={[zoneA, consZone]} sectorizedCounts={{ 'zone-cons': 12 }} />);
    const row = screen.getByTestId('dock-list-row-zone-cons');
    expect(within(row).getByText('CONS')).toBeInTheDocument();
    expect(within(row).getAllByText(/consolidaci/i).length).toBeGreaterThan(0);
  });

  it('shows the fill bar only where capacity is configured', () => {
    render(
      <DockListMobile
        zones={[zoneA, zoneB]}
        sectorizedCounts={{ 'zone-a1': 169, 'zone-b1': 4 }}
      />,
    );
    const rowA = screen.getByTestId('dock-list-row-zone-a1');
    expect(within(rowA).getByTestId('dock-capacity-fill')).toBeInTheDocument();

    const rowB = screen.getByTestId('dock-list-row-zone-b1');
    expect(within(rowB).queryByTestId('dock-capacity-fill')).not.toBeInTheDocument();
  });

  it('treats a missing count as zero', () => {
    render(<DockListMobile zones={[zoneA]} sectorizedCounts={{}} />);
    const row = screen.getByTestId('dock-list-row-zone-a1');
    expect(within(row).getByText('0')).toBeInTheDocument();
  });

  it('renders an EmptyState when no active andenes are configured', () => {
    render(<DockListMobile zones={[inactiveZone]} sectorizedCounts={{}} />);
    expect(screen.getByText('Sin andenes configurados')).toBeInTheDocument();
    expect(screen.queryByTestId(/dock-list-row-/)).not.toBeInTheDocument();
  });

  it('renders an EmptyState with no zones at all', () => {
    render(<DockListMobile zones={[]} sectorizedCounts={{}} />);
    expect(screen.getByText('Sin andenes configurados')).toBeInTheDocument();
  });

  it('every row is at least 44px tall', () => {
    render(<DockListMobile zones={[zoneA]} sectorizedCounts={{ 'zone-a1': 1 }} />);
    const row = screen.getByTestId('dock-list-row-zone-a1');
    expect(row.className).toMatch(/min-h-\[(4[4-9]|[5-9]\d|\d{3,})px\]/);
  });

  describe('the unconfigured-capacity row (4l A6)', () => {
    it('renders no occupancy element and renders an explanatory region instead', () => {
      render(<DockListMobile zones={[zoneB]} sectorizedCounts={{ 'zone-b1': 4 }} />);
      const row = screen.getByTestId('dock-list-row-zone-b1');
      expect(within(row).queryByTestId('dock-capacity-fill')).not.toBeInTheDocument();
      expect(within(row).getByTestId('dock-capacity-unconfigured')).toBeInTheDocument();
    });

    it('renders the bar and no explanatory region when capacity is configured', () => {
      render(<DockListMobile zones={[zoneA]} sectorizedCounts={{ 'zone-a1': 169 }} />);
      const row = screen.getByTestId('dock-list-row-zone-a1');
      expect(within(row).getByTestId('dock-capacity-fill')).toBeInTheDocument();
      expect(within(row).queryByTestId('dock-capacity-unconfigured')).not.toBeInTheDocument();
    });

    // Review round 1 (finding #4) — a hand-rolled `capacity > 0` check is
    // what getDockCapacityStatus already floors; capacity: 0 must land in
    // the unconfigured branch (bar absent, explanatory region present),
    // never a bare number with neither.
    it('treats capacity: 0 the same as null — unconfigured, not a bare number', () => {
      render(<DockListMobile zones={[zoneZeroCapacity]} sectorizedCounts={{ 'zone-zero': 5 }} />);
      const row = screen.getByTestId('dock-list-row-zone-zero');
      expect(within(row).queryByTestId('dock-capacity-fill')).not.toBeInTheDocument();
      expect(within(row).getByTestId('dock-capacity-unconfigured')).toBeInTheDocument();
    });
  });

  // Review round 2 (finding #5) — the subtitle slot's ternary (note vs.
  // comuna list) survived the rename mutation untested; both halves get
  // their own assertion now.
  describe('the subtitle slot', () => {
    it('renders the unconfigured note and not the comuna list', () => {
      render(<DockListMobile zones={[zoneB]} sectorizedCounts={{ 'zone-b1': 4 }} />);
      const row = screen.getByTestId('dock-list-row-zone-b1');
      expect(within(row).getByTestId('dock-unconfigured-note')).toBeInTheDocument();
      expect(within(row).queryByTestId('dock-comunas-note')).not.toBeInTheDocument();
    });

    it('renders the comuna list and not the unconfigured note when configured', () => {
      render(<DockListMobile zones={[zoneA]} sectorizedCounts={{ 'zone-a1': 10 }} />);
      const row = screen.getByTestId('dock-list-row-zone-a1');
      expect(within(row).getByTestId('dock-comunas-note')).toBeInTheDocument();
      expect(within(row).queryByTestId('dock-unconfigured-note')).not.toBeInTheDocument();
    });

    // Review round 2 (finding #3) — the consolidation zone's `capacity:
    // null` is by design; it must not get the setup-incomplete note.
    it('renders neither note nor comuna list for the (unconfigured) consolidation zone', () => {
      render(<DockListMobile zones={[consZone]} sectorizedCounts={{ 'zone-cons': 12 }} />);
      const row = screen.getByTestId('dock-list-row-zone-cons');
      expect(within(row).queryByTestId('dock-unconfigured-note')).not.toBeInTheDocument();
      expect(within(row).queryByTestId('dock-comunas-note')).not.toBeInTheDocument();
    });
  });

  describe('the status chip (same family as 4a)', () => {
    // Review round 1 (finding #3) — the designer's ruling: `SIN ABRIR` is
    // `4a`'s "no open batch" (activity), not `4l`'s "no capacity" reading
    // this phase shipped first. This list has no per-zone batch source, so
    // an unconfigured row gets no chip at all — the explanatory region
    // already says so — exactly like the neutral-tone case below.
    it('renders no chip for an unconfigured zone — its explanatory region already says so', () => {
      render(<DockListMobile zones={[zoneB]} sectorizedCounts={{ 'zone-b1': 4 }} />);
      const row = screen.getByTestId('dock-list-row-zone-b1');
      expect(within(row).queryByTestId('dock-status-chip')).not.toBeInTheDocument();
    });

    it('marks a near-full configured zone with the near-full chip state', () => {
      render(
        <DockListMobile
          zones={[zoneA]}
          sectorizedCounts={{ 'zone-a1': 169 }} // 169/180 = 93.9% >= warning threshold
        />,
      );
      const row = screen.getByTestId('dock-list-row-zone-a1');
      expect(within(row).getByTestId('dock-status-chip')).toHaveAttribute(
        'data-state',
        'near-full',
      );
    });

    it('renders no chip for a configured zone in the neutral tone', () => {
      render(<DockListMobile zones={[zoneA]} sectorizedCounts={{ 'zone-a1': 10 }} />);
      const row = screen.getByTestId('dock-list-row-zone-a1');
      expect(within(row).queryByTestId('dock-status-chip')).not.toBeInTheDocument();
    });
  });
});
