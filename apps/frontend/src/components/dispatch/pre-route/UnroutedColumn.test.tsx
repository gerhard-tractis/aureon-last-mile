import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UnroutedColumn } from './UnroutedColumn';
import type { UnroutedGroup } from '@/hooks/dispatch/pre-route/useUnroutedGroups';
import * as useOrderPackagesModule from '@/hooks/dispatch/pre-route/useOrderPackages';

// Module-level, not per-test: every test in this file renders collapsed rows,
// so one spy for the whole file is enough — restored once at the end rather
// than per-test, which would undo it before the next test could use it.
vi.spyOn(useOrderPackagesModule, 'useOrderPackages').mockReturnValue({
  data: undefined,
  isLoading: false,
  isError: false,
} as ReturnType<typeof useOrderPackagesModule.useOrderPackages>);

afterAll(() => {
  vi.restoreAllMocks();
});

const GROUPS: UnroutedGroup[] = [
  {
    id: 'a1',
    name: 'Sur Oriente',
    subtitle: 'La Florida · Puente Alto',
    orderCount: 2,
    packageCount: 5,
    warning: false,
    orders: [
      {
        id: 'o1',
        orderNumber: 'ORD-001',
        comunaName: 'La Florida',
        address: 'Calle Uno 111',
        packageCount: 2,
        windowStart: '08:00:00',
        windowEnd: '12:00:00',
        hasSplitDockZone: false,
      },
      {
        id: 'o2',
        orderNumber: 'ORD-002',
        comunaName: 'Puente Alto',
        address: 'Calle Dos 222',
        packageCount: 3,
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
    orderCount: 1,
    packageCount: 4,
    warning: true,
    orders: [
      {
        id: 'o3',
        orderNumber: 'ORD-003',
        comunaName: 'Maipú',
        address: 'Calle Tres 333',
        packageCount: 4,
        windowStart: '14:00:00',
        windowEnd: '18:00:00',
        hasSplitDockZone: true,
      },
    ],
  },
];

const EMPTY_SUMMARY = { groupCount: 0, orderCount: 0, packageCount: 0, comunaCount: 0, orderIds: [] };

const BASE = {
  groups: GROUPS,
  groupBy: 'anden' as const,
  onGroupByChange: () => {},
  selectedOrderIds: new Set<string>(),
  onToggleOrder: () => {},
  onToggleGroup: () => {},
  onSelectAll: () => {},
  onClearSelection: () => {},
  summary: EMPTY_SUMMARY,
  onBuildRoute: () => {},
};

describe('UnroutedColumn', () => {
  it('lists every order as its own row under the group header', () => {
    render(<UnroutedColumn {...BASE} />);
    expect(screen.getByText('Sur Oriente')).toBeInTheDocument();
    expect(screen.getByText('ORD-001')).toBeInTheDocument();
    expect(screen.getByText('ORD-002')).toBeInTheDocument();
    expect(screen.getByText('ORD-003')).toBeInTheDocument();
  });

  it('shows the total unrouted orders across groups', () => {
    render(<UnroutedColumn {...BASE} />);
    expect(screen.getByTestId('unrouted-total')).toHaveTextContent('3');
  });

  it('offers only the groupings the snapshot can actually produce', () => {
    render(<UnroutedColumn {...BASE} />);
    expect(screen.getByRole('button', { name: 'Por andén' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Por comuna' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cliente/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /sla/i })).toBeNull();
  });

  it('toggles one order when its row is clicked', async () => {
    const onToggleOrder = vi.fn();
    render(<UnroutedColumn {...BASE} onToggleOrder={onToggleOrder} />);
    await userEvent.click(screen.getByText('ORD-001'));
    expect(onToggleOrder).toHaveBeenCalledWith('o1');
  });

  it('toggles every order in a group from the group checkbox', async () => {
    const onToggleGroup = vi.fn();
    render(<UnroutedColumn {...BASE} onToggleGroup={onToggleGroup} />);
    await userEvent.click(screen.getByTestId('unrouted-group-a1'));
    expect(onToggleGroup).toHaveBeenCalledWith(GROUPS[0]);
  });

  it('flags a group split across dock zones', () => {
    render(<UnroutedColumn {...BASE} />);
    expect(screen.getByLabelText('Repartida entre varios andenes')).toBeInTheDocument();
  });

  it('shows the group subtitle — comunas covered (por andén) or andenes split across (por comuna)', () => {
    render(<UnroutedColumn {...BASE} />);
    // a1: "Por andén" grouping — subtitle is the comunas the andén covers.
    expect(screen.getByText('2 órdenes · 5 paquetes · La Florida · Puente Alto')).toBeInTheDocument();
    // a2: subtitle is "Maipú" — the andén(es) this (split) comuna is spread across.
    expect(screen.getByText('1 órdenes · 4 paquetes · Maipú')).toBeInTheDocument();
  });

  it('pairs the split-dock-zone warning with the andenes it names, in the same group header', () => {
    // The warning alone says a problem exists; the subtitle is the only place
    // on screen that says which andenes are involved — losing it would leave
    // the AlertTriangle pointing at nothing.
    render(<UnroutedColumn {...BASE} />);
    const splitHeader = screen.getByTestId('unrouted-group-a2');
    expect(within(splitHeader).getByLabelText('Repartida entre varios andenes')).toBeInTheDocument();
    expect(within(splitHeader).getByText(/Maipú/)).toBeInTheDocument();
  });

  it('renders no trailing separator when a group has no subtitle', () => {
    render(
      <UnroutedColumn
        {...BASE}
        groups={[{ ...GROUPS[0], subtitle: '' }]}
      />,
    );
    expect(screen.getByText('2 órdenes · 5 paquetes')).toBeInTheDocument();
  });

  it('reports the group checkbox tri-state as its orders get selected', () => {
    const { rerender } = render(<UnroutedColumn {...BASE} />);
    expect(screen.getByTestId('unrouted-group-a1')).toHaveAttribute('aria-checked', 'false');

    rerender(<UnroutedColumn {...BASE} selectedOrderIds={new Set(['o1'])} />);
    expect(screen.getByTestId('unrouted-group-a1')).toHaveAttribute('aria-checked', 'mixed');

    rerender(<UnroutedColumn {...BASE} selectedOrderIds={new Set(['o1', 'o2'])} />);
    expect(screen.getByTestId('unrouted-group-a1')).toHaveAttribute('aria-checked', 'true');
  });

  it('disables the build button until something is selected', () => {
    const { rerender } = render(<UnroutedColumn {...BASE} />);
    expect(screen.getByRole('button', { name: 'Armar ruta' })).toBeDisabled();

    rerender(
      <UnroutedColumn
        {...BASE}
        selectedOrderIds={new Set(['o1'])}
        summary={{ groupCount: 1, orderCount: 1, packageCount: 2, comunaCount: 1, orderIds: ['o1'] }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Armar ruta' })).toBeEnabled();
  });

  it('summarises the selection in the footer, pluralising comunas', () => {
    render(
      <UnroutedColumn
        {...BASE}
        summary={{ groupCount: 1, orderCount: 110, packageCount: 254, comunaCount: 2, orderIds: [] }}
      />,
    );
    expect(screen.getByText('110 seleccionadas · 254 paquetes · 2 comunas')).toBeInTheDocument();
  });

  it('pluralises singular comuna correctly', () => {
    render(
      <UnroutedColumn
        {...BASE}
        summary={{ groupCount: 1, orderCount: 1, packageCount: 2, comunaCount: 1, orderIds: ['o1'] }}
      />,
    );
    expect(screen.getByText('1 seleccionadas · 2 paquetes · 1 comuna')).toBeInTheDocument();
  });

  it('offers bulk select-all and clear actions in the footer', async () => {
    const onSelectAll = vi.fn();
    const onClearSelection = vi.fn();
    render(<UnroutedColumn {...BASE} onSelectAll={onSelectAll} onClearSelection={onClearSelection} />);
    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar todo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Limpiar selección' }));
    expect(onSelectAll).toHaveBeenCalled();
    expect(onClearSelection).toHaveBeenCalled();
  });

  it('shows an empty state when nothing is routable', () => {
    render(<UnroutedColumn {...BASE} groups={[]} />);
    expect(screen.getByText(/No hay órdenes listas para rutear/)).toBeInTheDocument();
  });
});
