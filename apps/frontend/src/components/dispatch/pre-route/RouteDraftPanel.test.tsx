import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouteDraftPanel } from './RouteDraftPanel';
import type { UnroutedGroup } from '@/hooks/dispatch/pre-route/useUnroutedGroups';

const GROUPS: UnroutedGroup[] = [
  {
    id: 'a1',
    name: 'Sur Oriente',
    subtitle: 'La Florida',
    orderCount: 62,
    packageCount: 148,
    orderIds: ['o1'],
    warning: false,
  },
  {
    id: 'a2',
    name: 'Poniente',
    subtitle: 'Maipú',
    orderCount: 30,
    packageCount: 70,
    orderIds: ['o2'],
    warning: false,
  },
];

const EMPTY = { groupCount: 0, orderCount: 0, packageCount: 0, comunaCount: 0, orderIds: [] };
const FILLED = {
  groupCount: 2,
  orderCount: 92,
  packageCount: 218,
  comunaCount: 2,
  orderIds: ['o1', 'o2'],
};

const BASE = {
  groups: GROUPS,
  selectedIds: new Set<string>(),
  summary: EMPTY,
  onBuildRoute: () => {},
  onClear: () => {},
};

describe('RouteDraftPanel', () => {
  it('prompts for a selection when empty', () => {
    render(<RouteDraftPanel {...BASE} />);
    expect(screen.getByText(/Selecciona uno o más grupos/)).toBeInTheDocument();
    expect(screen.queryByTestId('draft-group')).toBeNull();
  });

  it('lists the selected groups with totals', () => {
    render(<RouteDraftPanel {...BASE} selectedIds={new Set(['a1', 'a2'])} summary={FILLED} />);
    expect(screen.getAllByTestId('draft-group')).toHaveLength(2);
    expect(screen.getByText('92')).toBeInTheDocument();
    expect(screen.getByText('218')).toBeInTheDocument();
  });

  it('says where driver, vehicle and stop order get assigned', () => {
    // The mock puts them here, but they need a route that exists. Being
    // explicit beats rendering an empty driver card.
    render(<RouteDraftPanel {...BASE} selectedIds={new Set(['a1'])} summary={FILLED} />);
    expect(screen.getByText(/se asignan al/)).toBeInTheDocument();
  });

  it('keeps both footer actions disabled until something is selected', () => {
    render(<RouteDraftPanel {...BASE} />);
    expect(screen.getByRole('button', { name: 'Limpiar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Armar ruta' })).toBeDisabled();
  });

  it('builds and clears through its callbacks', async () => {
    const onBuildRoute = vi.fn();
    const onClear = vi.fn();
    render(
      <RouteDraftPanel
        {...BASE}
        selectedIds={new Set(['a1'])}
        summary={FILLED}
        onBuildRoute={onBuildRoute}
        onClear={onClear}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Armar ruta' }));
    await userEvent.click(screen.getByRole('button', { name: 'Limpiar' }));
    expect(onBuildRoute).toHaveBeenCalled();
    expect(onClear).toHaveBeenCalled();
  });

  it('blocks a double submit while the route is being created', () => {
    render(<RouteDraftPanel {...BASE} selectedIds={new Set(['a1'])} summary={FILLED} isBuilding />);
    expect(screen.getByRole('button', { name: 'Armando…' })).toBeDisabled();
  });
});
