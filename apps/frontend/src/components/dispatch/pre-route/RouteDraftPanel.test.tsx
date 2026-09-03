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
    warning: false,
    orders: [
      {
        id: 'o1',
        orderNumber: 'ORD-001',
        comunaName: 'La Florida',
        address: 'Calle Uno 111',
        packageCount: 92,
        windowStart: null,
        windowEnd: null,
        hasSplitDockZone: false,
      },
    ],
  },
  {
    id: 'a2',
    name: 'Poniente',
    subtitle: 'Maipú',
    orderCount: 30,
    packageCount: 70,
    warning: false,
    orders: [
      {
        id: 'o2',
        orderNumber: 'ORD-002',
        comunaName: 'Maipú',
        address: 'Calle Dos 222',
        packageCount: 126,
        windowStart: null,
        windowEnd: null,
        hasSplitDockZone: false,
      },
    ],
  },
];

const EMPTY = { groupCount: 0, orderCount: 0, packageCount: 0, comunaCount: 0, orderIds: [] };
const FILLED = {
  groupCount: 2,
  orderCount: 2,
  packageCount: 218,
  comunaCount: 2,
  orderIds: ['o1', 'o2'],
};

const BASE = {
  groups: GROUPS,
  selectedOrderIds: new Set<string>(),
  summary: EMPTY,
  onBuildRoute: () => {},
  onClear: () => {},
};

describe('RouteDraftPanel', () => {
  it('prompts for a selection when empty', () => {
    render(<RouteDraftPanel {...BASE} />);
    expect(screen.getByText(/Selecciona una o más órdenes/)).toBeInTheDocument();
    expect(screen.queryByTestId('draft-order')).toBeNull();
  });

  it('lists the selected orders with totals', () => {
    render(<RouteDraftPanel {...BASE} selectedOrderIds={new Set(['o1', 'o2'])} summary={FILLED} />);
    expect(screen.getAllByTestId('draft-order')).toHaveLength(2);
    expect(screen.getByText('ORD-001')).toBeInTheDocument();
    expect(screen.getByText('ORD-002')).toBeInTheDocument();
    expect(screen.getByTestId('draft-order-count')).toHaveTextContent('2');
    expect(screen.getByTestId('draft-package-count')).toHaveTextContent('218');
  });

  it('says where driver, vehicle and stop order get assigned', () => {
    render(<RouteDraftPanel {...BASE} selectedOrderIds={new Set(['o1'])} summary={FILLED} />);
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
        selectedOrderIds={new Set(['o1'])}
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
    render(
      <RouteDraftPanel {...BASE} selectedOrderIds={new Set(['o1'])} summary={FILLED} isBuilding />,
    );
    expect(screen.getByRole('button', { name: 'Armando…' })).toBeDisabled();
  });
});
