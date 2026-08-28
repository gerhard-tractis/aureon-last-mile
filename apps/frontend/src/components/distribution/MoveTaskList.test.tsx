import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MoveTaskList } from './MoveTaskList';
import type { MoveTaskRoute, MoveTaskUnassignedRoute } from '@/lib/types';

const ROUTE: MoveTaskRoute = {
  route_id: 'route-1',
  external_route_id: 'R-042',
  driver_name: 'Juan Pérez',
  load_position_id: 'pos-1',
  load_position_code: 'POS-02',
  load_position_label: 'Frente a Andén A2',
  total_packages: 37,
  remaining_packages: 14,
  offset_conflict: false,
  groups: [
    { dock_zone_id: 'zone-a1', dock_zone_code: 'A1', dock_zone_name: 'Andén A1', is_retired: false, remaining_count: 6 },
    { dock_zone_id: 'zone-a3', dock_zone_code: 'A3', dock_zone_name: 'Andén A3', is_retired: false, remaining_count: 8 },
  ],
};

const CONFLICT_ROUTE: MoveTaskRoute = {
  ...ROUTE,
  route_id: 'route-2',
  external_route_id: 'R-043',
  offset_conflict: true,
  remaining_packages: 0,
  groups: [],
};

const RETIRED_GROUP_ROUTE: MoveTaskRoute = {
  ...ROUTE,
  route_id: 'route-3',
  external_route_id: 'R-044',
  groups: [
    { dock_zone_id: 'zone-gone', dock_zone_code: null, dock_zone_name: null, is_retired: true, remaining_count: 3 },
  ],
};

// Review item 7 — a package that was never sectorized onto an andén at all
// (dock_zone_id IS NULL) is a different fact from a retired andén: not
// `is_retired`, and it must still read as "Sin andén" rather than a blank
// label or a crash.
const NO_ANDEN_ROUTE: MoveTaskRoute = {
  ...ROUTE,
  route_id: 'route-4',
  external_route_id: 'R-045',
  remaining_packages: 2,
  groups: [
    { dock_zone_id: null, dock_zone_code: null, dock_zone_name: null, is_retired: false, remaining_count: 2 },
  ],
};

const UNASSIGNED: MoveTaskUnassignedRoute = {
  route_id: 'route-9',
  external_route_id: 'R-099',
  driver_name: null,
  total_packages: 5,
  remaining_packages: 5,
};

describe('MoveTaskList', () => {
  it('shows an empty state when there is nothing to move and nothing blocked', () => {
    render(<MoveTaskList routes={[]} unassignedRoutes={[]} />);
    expect(screen.getByText('Nada por mover')).toBeInTheDocument();
  });

  it('renders a route card with the andén groups and the faltan count', () => {
    render(<MoveTaskList routes={[ROUTE]} unassignedRoutes={[]} />);

    expect(screen.getByText(/Ruta R-042/)).toBeInTheDocument();
    expect(screen.getByText('Faltan 14 de 37')).toBeInTheDocument();
    expect(screen.getByText('A1')).toBeInTheDocument();
    expect(screen.getByText('A3')).toBeInTheDocument();
    expect(screen.getByText(/6 paquetes → POS-02/)).toBeInTheDocument();
    expect(screen.getByText(/8 paquetes → POS-02/)).toBeInTheDocument();
  });

  it('renders the offset-conflict banner on a conflicting route, even with nothing left to stage', () => {
    render(<MoveTaskList routes={[CONFLICT_ROUTE]} unassignedRoutes={[]} />);
    expect(screen.getByTestId('move-task-conflict-route-2')).toBeInTheDocument();
    expect(screen.getByText(/Reasigna la posición/)).toBeInTheDocument();
  });

  it('does not render a conflict banner on a non-conflicting route', () => {
    render(<MoveTaskList routes={[ROUTE]} unassignedRoutes={[]} />);
    expect(screen.queryByTestId('move-task-conflict-route-1')).not.toBeInTheDocument();
  });

  it('renders a retired andén group without crashing and without vanishing it', () => {
    render(<MoveTaskList routes={[RETIRED_GROUP_ROUTE]} unassignedRoutes={[]} />);
    expect(screen.getByText('Andén eliminado')).toBeInTheDocument();
    expect(screen.getByText(/3 paquetes → POS-02/)).toBeInTheDocument();
  });

  it('renders "Sin andén" for a package with no dock_zone_id at all, distinct from a retired andén', () => {
    render(<MoveTaskList routes={[NO_ANDEN_ROUTE]} unassignedRoutes={[]} />);
    expect(screen.getByText('Sin andén')).toBeInTheDocument();
    expect(screen.queryByText('Andén eliminado')).not.toBeInTheDocument();
    expect(screen.getByText(/2 paquetes → POS-02/)).toBeInTheDocument();
  });

  it('renders the unassigned-routes section as blocked, with a reason', () => {
    render(<MoveTaskList routes={[]} unassignedRoutes={[UNASSIGNED]} />);
    expect(screen.getByTestId('move-task-unassigned-section')).toBeInTheDocument();
    expect(screen.getByText('1 ruta sin posición de carga asignada')).toBeInTheDocument();
    expect(screen.getByText(/Ruta R-099/)).toBeInTheDocument();
    expect(screen.getByTestId('move-task-unassigned-route-9')).toHaveTextContent('sin posición');
  });

  it('renders both routes and unassigned routes together, not as a separate screen', () => {
    render(<MoveTaskList routes={[ROUTE]} unassignedRoutes={[UNASSIGNED]} />);
    expect(screen.getByTestId('move-task-route-route-1')).toBeInTheDocument();
    expect(screen.getByTestId('move-task-unassigned-section')).toBeInTheDocument();
  });
});
