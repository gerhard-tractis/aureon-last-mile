import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DockZoneGrid } from './DockZoneGrid';

const zones = [
  {
    id: 'z1',
    name: 'Andén 1',
    code: 'DOCK-001',
    is_consolidation: false,
    comunas: ['las condes', 'vitacura'],
    is_active: true,
    operator_id: 'op-1',
  },
  {
    id: 'z2',
    name: 'Andén 2',
    code: 'DOCK-002',
    is_consolidation: false,
    comunas: ['providencia'],
    is_active: true,
    operator_id: 'op-1',
  },
];

describe('DockZoneGrid', () => {
  it('renders a card per zone', () => {
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
    // "2 comunas" for zone 1
    expect(screen.getByText(/2 comun/i)).toBeInTheDocument();
  });

  it('shows empty state when no zones', () => {
    render(<DockZoneGrid zones={[]} />);
    expect(screen.getByText(/no hay andenes/i)).toBeInTheDocument();
  });
});
