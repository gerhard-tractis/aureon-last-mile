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
  it('shows CASI LLENO for a near-full zone, regardless of open lotes', () => {
    render(
      <OutboundDockGrid
        zones={[zone({ id: 'z', capacity: 180 })]}
        sectorizedCounts={{ z: 169 }}
        openBatches={{ z: 2 }}
      />,
    );
    const chip = within(screen.getByTestId('outbound-dock')).getByTestId('outbound-dock-chip');
    expect(chip).toHaveTextContent('CASI LLENO');
    expect(chip.dataset.state).toBe('near-full');
  });

  it('shows EN RITMO for a zone with an open lote and no capacity pressure', () => {
    render(
      <OutboundDockGrid
        zones={[zone({ id: 'z', capacity: 180 })]}
        sectorizedCounts={{ z: 96 }}
        openBatches={{ z: 1 }}
      />,
    );
    const chip = within(screen.getByTestId('outbound-dock')).getByTestId('outbound-dock-chip');
    expect(chip).toHaveTextContent('EN RITMO');
    expect(chip.dataset.state).toBe('active');
  });

  it('shows SIN ABRIR for a zone with no open lote', () => {
    render(
      <OutboundDockGrid
        zones={[zone({ id: 'z', capacity: 120 })]}
        sectorizedCounts={{ z: 0 }}
        openBatches={{ z: 0 }}
      />,
    );
    const chip = within(screen.getByTestId('outbound-dock')).getByTestId('outbound-dock-chip');
    expect(chip).toHaveTextContent('SIN ABRIR');
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

  it('never applies error styling to the chip, even over 100% fill', () => {
    // The artboard reserves the error tone/border for a blocked dock
    // (DETENIDO), never a full one.
    render(
      <OutboundDockGrid
        zones={[zone({ id: 'z', capacity: 100 })]}
        sectorizedCounts={{ z: 120 }}
      />,
    );
    const chip = within(screen.getByTestId('outbound-dock')).getByTestId('outbound-dock-chip');
    expect(chip).toHaveTextContent('CASI LLENO');
    expect(chip.className).not.toMatch(/status-error/);
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
  it('offers Abrir for a dock with no open lote', () => {
    render(
      <OutboundDockGrid
        zones={[zone({ id: 'z', capacity: 120 })]}
        sectorizedCounts={{ z: 0 }}
        openBatches={{ z: 0 }}
      />,
    );
    expect(within(screen.getByTestId('outbound-dock')).getByText('Abrir')).toBeInTheDocument();
  });

  it('offers Ver for a dock with an open lote', () => {
    render(
      <OutboundDockGrid
        zones={[zone({ id: 'z', capacity: 120 })]}
        sectorizedCounts={{ z: 30 }}
        openBatches={{ z: 1 }}
      />,
    );
    expect(within(screen.getByTestId('outbound-dock')).getByText('Ver')).toBeInTheDocument();
  });
});
