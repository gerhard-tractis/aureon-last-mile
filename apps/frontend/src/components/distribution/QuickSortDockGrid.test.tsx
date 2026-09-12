import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QuickSortDockGrid } from './QuickSortDockGrid';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';

function zone(overrides: Partial<DockZoneRecord> = {}): DockZoneRecord {
  return {
    id: 'zone-a',
    name: 'Andén A',
    code: 'A1',
    is_consolidation: false,
    comunas: [],
    is_active: true,
    operator_id: 'op-1',
    capacity: null,
    ...overrides,
  };
}

describe('QuickSortDockGrid', () => {
  it('passes a non-null occupancyPct to a dock with a configured capacity', () => {
    render(
      <QuickSortDockGrid
        zones={[zone({ id: 'zone-a', capacity: 200 })]}
        sectorizedByZone={{ 'zone-a': 100 }}
      />,
    );
    // 100/200 -> 50% fill width, via the same DockCapacityBar/DockCard path.
    expect(screen.getByTestId('dock-occupancy').style.width).toBe('50%');
  });

  it('renders no occupancy bar for a dock with no configured capacity', () => {
    render(
      <QuickSortDockGrid
        zones={[zone({ id: 'zone-a', capacity: null })]}
        sectorizedByZone={{ 'zone-a': 40 }}
      />,
    );
    expect(screen.queryByTestId('dock-occupancy')).toBeNull();
  });

  it('highlights the tile matching activeZoneCode', () => {
    render(
      <QuickSortDockGrid
        zones={[zone({ id: 'zone-a', code: 'A1' })]}
        sectorizedByZone={{}}
        activeZoneCode="A1"
      />,
    );
    expect(screen.getByText('ACTIVO')).toBeInTheDocument();
  });
});
