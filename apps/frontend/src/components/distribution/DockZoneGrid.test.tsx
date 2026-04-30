import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DockZoneGrid } from './DockZoneGrid';

const zones = [
  {
    id: 'z1',
    name: 'Andén 1',
    code: 'DOCK-001',
    is_consolidation: false,
    comunas: [
      { id: 'c1', nombre: 'las condes' },
      { id: 'c2', nombre: 'vitacura' },
    ],
    is_active: true,
    operator_id: 'op-1',
  },
  {
    id: 'z2',
    name: 'Andén 2',
    code: 'DOCK-002',
    is_consolidation: false,
    comunas: [{ id: 'c3', nombre: 'providencia' }],
    is_active: true,
    operator_id: 'op-1',
  },
];

describe('DockZoneGrid', () => {
  it('renders a row per zone', () => {
    render(<DockZoneGrid zones={zones} />);
    expect(screen.getByText('Andén 1')).toBeInTheDocument();
    expect(screen.getByText('Andén 2')).toBeInTheDocument();
  });

  it('shows the code for each zone', () => {
    render(<DockZoneGrid zones={zones} />);
    expect(screen.getByText('DOCK-001')).toBeInTheDocument();
    expect(screen.getByText('DOCK-002')).toBeInTheDocument();
  });

  it('shows comunas count', () => {
    render(<DockZoneGrid zones={zones} />);
    expect(screen.getByText(/^comunas$/i)).toBeInTheDocument(); // label "comunas" appears for zone 1 (count 2)
    // Zone 1 has 2 comunas — number rendered in stat box
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows empty state when no zones', () => {
    render(<DockZoneGrid zones={[]} />);
    expect(screen.getByText('Sin andenes activos')).toBeInTheDocument();
    expect(screen.getByText(/activa al menos uno/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /configurar andenes/i })).toHaveAttribute('href', '/app/distribution/settings');
  });

  it('shows sectorized package count on each row', () => {
    render(<DockZoneGrid zones={zones} sectorizedCounts={{ z1: 7, z2: 3 }} />);
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows zero count label when zone has no sectorized packages', () => {
    render(<DockZoneGrid zones={zones} sectorizedCounts={{}} />);
    // Two zones × 1 zero each = at least 2 zeros (each zone shows "0 paquetes")
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(2);
  });

  it('does not render any reorder controls (sort is alphabetical-by-name)', () => {
    render(<DockZoneGrid zones={zones} />);
    expect(screen.queryByLabelText(/Mover Andén/)).toBeNull();
  });
});
