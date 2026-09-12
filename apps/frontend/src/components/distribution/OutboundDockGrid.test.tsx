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

// spec-96 fase 0 review — pins the actual mapping, not merely that two
// states differ. A prior version of this test only asserted the states
// were distinct, which stayed green against an inverted implementation.
describe('OutboundDockGrid capacity chip mapping', () => {
  it('shows the CASI LLENO chip for a zone at ~93% fill (warning tone)', () => {
    render(
      <OutboundDockGrid
        zones={[zone({ id: 'zone-near-full', capacity: 180 })]}
        sectorizedCounts={{ 'zone-near-full': 169 }}
      />,
    );
    const tile = screen.getByTestId('outbound-dock');
    expect(within(tile).getByTestId('outbound-dock-capacity-state')).toHaveTextContent(
      'CASI LLENO',
    );
  });

  it('shows no capacity chip for a configured zone at 0% fill (neutral tone)', () => {
    render(
      <OutboundDockGrid
        zones={[zone({ id: 'zone-empty', capacity: 180 })]}
        sectorizedCounts={{ 'zone-empty': 0 }}
      />,
    );
    const tile = screen.getByTestId('outbound-dock');
    expect(within(tile).queryByTestId('outbound-dock-capacity-state')).toBeNull();
  });

  it('shows no capacity chip and no fill bar for a zone with no capacity configured', () => {
    render(
      <OutboundDockGrid
        zones={[zone({ id: 'zone-unconfigured', capacity: null })]}
        sectorizedCounts={{ 'zone-unconfigured': 40 }}
      />,
    );
    const tile = screen.getByTestId('outbound-dock');
    expect(within(tile).queryByTestId('outbound-dock-capacity-state')).toBeNull();
    expect(within(tile).queryByTestId('dock-capacity-fill')).toBeNull();
  });

  it('never applies error styling to the capacity chip, even over 100% fill', () => {
    // The artboard reserves the error tone/border for a blocked dock
    // (DETENIDO), never a full one — a full dock must read the same
    // CASI LLENO chip as a near-full one, not an error-styled variant.
    render(
      <OutboundDockGrid
        zones={[zone({ id: 'zone-over-full', capacity: 100 })]}
        sectorizedCounts={{ 'zone-over-full': 120 }}
      />,
    );
    const tile = screen.getByTestId('outbound-dock');
    const chip = within(tile).getByTestId('outbound-dock-capacity-state');
    expect(chip).toHaveTextContent('CASI LLENO');
    expect(chip.className).not.toMatch(/status-error/);
  });
});

describe('OutboundDockGrid — Activo/Inactivo text (restored, unchanged)', () => {
  it('shows Activo for an active zone', () => {
    render(<OutboundDockGrid zones={[zone({ is_active: true })]} />);
    expect(screen.getByText('Activo')).toBeInTheDocument();
  });

  it('shows Inactivo for an inactive zone', () => {
    // Note: distribution/page.tsx, this grid's only caller, filters to
    // is_active zones before rendering, so this branch is unreachable in
    // production today. The component's own contract still allows it.
    render(<OutboundDockGrid zones={[zone({ is_active: false })]} />);
    expect(screen.getByText('Inactivo')).toBeInTheDocument();
  });
});
