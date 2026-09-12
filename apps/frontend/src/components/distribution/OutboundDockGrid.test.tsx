import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { OutboundDockGrid } from './OutboundDockGrid';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';

function zone(overrides: Partial<DockZoneRecord> = {}): DockZoneRecord {
  return {
    id: 'zone-a',
    name: 'Sur Oriente',
    code: 'A3',
    is_consolidation: false,
    comunas: [],
    is_active: true,
    operator_id: 'op-1',
    capacity: null,
    ...overrides,
  };
}

describe('OutboundDockGrid capacity', () => {
  it('renders the capacity fill for a configured zone', () => {
    render(
      <OutboundDockGrid
        zones={[zone({ id: 'zone-configured', capacity: 180 })]}
        sectorizedCounts={{ 'zone-configured': 169 }}
      />,
    );
    const tile = screen.getByTestId('outbound-dock');
    expect(within(tile).getByTestId('dock-capacity-fill')).toBeInTheDocument();
  });

  it('renders no capacity fill for a zone with no configured capacity', () => {
    render(
      <OutboundDockGrid
        zones={[zone({ id: 'zone-unconfigured', capacity: null })]}
        sectorizedCounts={{ 'zone-unconfigured': 0 }}
      />,
    );
    const tile = screen.getByTestId('outbound-dock');
    expect(within(tile).queryByTestId('dock-capacity-fill')).toBeNull();
  });
});

describe('OutboundDockGrid activity state', () => {
  it('distinguishes an open-batch zone from an inactive zone via data-state', () => {
    render(
      <OutboundDockGrid
        zones={[
          zone({ id: 'zone-open', is_active: true }),
          zone({ id: 'zone-inactive', is_active: false }),
        ]}
        openBatches={{ 'zone-open': 2, 'zone-inactive': 0 }}
      />,
    );
    const tiles = screen.getAllByTestId('outbound-dock');
    const openTile = tiles[0];
    const inactiveTile = tiles[1];

    const openState = within(openTile).getByTestId('outbound-dock-activity');
    const inactiveState = within(inactiveTile).getByTestId('outbound-dock-activity');

    expect(openState.dataset.state).not.toBe(inactiveState.dataset.state);
  });
});
