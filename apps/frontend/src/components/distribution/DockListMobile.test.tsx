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
});
