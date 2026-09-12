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

// spec-96 fase 4 — `4a` draws exactly one activity/capacity chip per tile,
// from CASI LLENO / EN RITMO / SIN ABRIR (DETENIDO is a declared gap: it
// needs a driver-assignment source no table carries pre-load — see the
// component's doc comment). Precedence: capacity tone over activity, so a
// near-full dock reads CASI LLENO even while a lote is open.
describe('OutboundDockGrid — chip state machine', () => {
  it('shows the near-full chip state for a near-full zone, regardless of open lotes', () => {
    render(
      <OutboundDockGrid
        zones={[zone({ id: 'z', capacity: 180 })]}
        sectorizedCounts={{ z: 169 }}
        openBatches={{ z: 2 }}
      />,
    );
    const chip = within(screen.getByTestId('outbound-dock')).getByTestId('outbound-dock-chip');
    expect(chip.dataset.state).toBe('near-full');
  });

  it('shows the active chip state for a zone with an open lote and no capacity pressure', () => {
    render(
      <OutboundDockGrid
        zones={[zone({ id: 'z', capacity: 180 })]}
        sectorizedCounts={{ z: 96 }}
        openBatches={{ z: 1 }}
      />,
    );
    const chip = within(screen.getByTestId('outbound-dock')).getByTestId('outbound-dock-chip');
    expect(chip.dataset.state).toBe('active');
  });

  it('shows the unopened chip state for a zone with no open lote', () => {
    render(
      <OutboundDockGrid
        zones={[zone({ id: 'z', capacity: 120 })]}
        sectorizedCounts={{ z: 0 }}
        openBatches={{ z: 0 }}
      />,
    );
    const chip = within(screen.getByTestId('outbound-dock')).getByTestId('outbound-dock-chip');
    expect(chip.dataset.state).toBe('unopened');
  });

  it('shows SIN ABRIR for an unconfigured-capacity zone with no open lote (4l A6)', () => {
    render(
      <OutboundDockGrid
        zones={[zone({ id: 'z', capacity: null })]}
        sectorizedCounts={{ z: 0 }}
        openBatches={{}}
      />,
    );
    const chip = within(screen.getByTestId('outbound-dock')).getByTestId('outbound-dock-chip');
    expect(chip.dataset.state).toBe('unopened');
  });

  it('keeps the near-full chip state even over 100% fill — never a distinct state for a full dock', () => {
    // The artboard reserves a different visual treatment for a blocked dock
    // (DETENIDO, not implemented) — a full dock must resolve to the SAME
    // chip state as a near-full one, not a third state of its own.
    render(
      <OutboundDockGrid
        zones={[zone({ id: 'z', capacity: 100 })]}
        sectorizedCounts={{ z: 120 }}
      />,
    );
    const chip = within(screen.getByTestId('outbound-dock')).getByTestId('outbound-dock-chip');
    expect(chip.dataset.state).toBe('near-full');
  });

  // Review fix — the chip render was gated on `!consolidation`, an
  // unintended side effect of this phase's rewrite: before it, any
  // near-full zone (consolidation included) got CASI LLENO. `4a` has no
  // consolidation tile to confirm either way, so this is a declared
  // decision, not an artboard fact: the consolidation zone is the ONE
  // surface that would warn an overflowing consolidation, so it keeps the
  // same chip machine as every other zone.
  it('shows the near-full chip on the consolidation zone too, when it has a capacity and is near it', () => {
    render(
      <OutboundDockGrid
        zones={[zone({ id: 'z', is_consolidation: true, capacity: 100 })]}
        sectorizedCounts={{ z: 95 }}
      />,
    );
    const chip = within(screen.getByTestId('outbound-dock')).getByTestId('outbound-dock-chip');
    expect(chip.dataset.state).toBe('near-full');
  });

  it('renders no LOTE/LOTES count badge — the chip is the only activity signal', () => {
    render(
      <OutboundDockGrid
        zones={[zone({ id: 'z', capacity: 180 })]}
        sectorizedCounts={{ z: 50 }}
        openBatches={{ z: 3 }}
      />,
    );
    const tile = screen.getByTestId('outbound-dock');
    expect(within(tile).queryByText(/LOTE/)).toBeNull();
  });
});

describe('OutboundDockGrid — tile footer action', () => {
  it('offers the "abrir" action for a dock with no open lote', () => {
    render(
      <OutboundDockGrid
        zones={[zone({ id: 'z', capacity: 120 })]}
        sectorizedCounts={{ z: 0 }}
        openBatches={{ z: 0 }}
      />,
    );
    expect(
      within(screen.getByTestId('outbound-dock')).getByTestId('outbound-dock-action').dataset.action,
    ).toBe('abrir');
  });

  it('offers the "ver" action for a dock with an open lote', () => {
    render(
      <OutboundDockGrid
        zones={[zone({ id: 'z', capacity: 120 })]}
        sectorizedCounts={{ z: 30 }}
        openBatches={{ z: 1 }}
      />,
    );
    expect(
      within(screen.getByTestId('outbound-dock')).getByTestId('outbound-dock-action').dataset.action,
    ).toBe('ver');
  });
});
