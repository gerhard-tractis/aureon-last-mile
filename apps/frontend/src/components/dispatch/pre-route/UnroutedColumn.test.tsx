import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UnroutedColumn } from './UnroutedColumn';
import type { UnroutedGroup } from '@/hooks/dispatch/pre-route/useUnroutedGroups';

const GROUPS: UnroutedGroup[] = [
  {
    id: 'a1',
    name: 'Sur Oriente',
    subtitle: 'La Florida · Puente Alto',
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
    warning: true,
  },
];

const BASE = {
  groups: GROUPS,
  groupBy: 'anden' as const,
  onGroupByChange: () => {},
  selectedIds: new Set<string>(),
  onToggle: () => {},
  summary: { groupCount: 0, orderCount: 0, packageCount: 0, comunaCount: 0, orderIds: [] },
  onBuildRoute: () => {},
};

describe('UnroutedColumn', () => {
  it('lists each group with its counts', () => {
    render(<UnroutedColumn {...BASE} />);
    expect(screen.getByText('Sur Oriente')).toBeInTheDocument();
    expect(screen.getByText(/62 órdenes · 148 paquetes/)).toBeInTheDocument();
  });

  it('shows the total unrouted across groups', () => {
    render(<UnroutedColumn {...BASE} />);
    expect(screen.getByText('92')).toBeInTheDocument();
  });

  it('offers only the groupings the snapshot can actually produce', () => {
    // "Por cliente" and "Por SLA" are in the mock but not in the data.
    render(<UnroutedColumn {...BASE} />);
    expect(screen.getByRole('button', { name: 'Por andén' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Por comuna' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cliente/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /sla/i })).toBeNull();
  });

  it('makes the whole row the hit target, not just the checkbox', async () => {
    const onToggle = vi.fn();
    render(<UnroutedColumn {...BASE} onToggle={onToggle} />);
    await userEvent.click(screen.getByText('Sur Oriente'));
    expect(onToggle).toHaveBeenCalledWith('a1');
  });

  it('reports selection state through aria-checked', () => {
    render(<UnroutedColumn {...BASE} selectedIds={new Set(['a1'])} />);
    const [first, second] = screen.getAllByTestId('unrouted-group');
    expect(first).toHaveAttribute('aria-checked', 'true');
    expect(second).toHaveAttribute('aria-checked', 'false');
  });

  it('flags a group split across dock zones', () => {
    render(<UnroutedColumn {...BASE} />);
    expect(screen.getByLabelText('Repartida entre varios andenes')).toBeInTheDocument();
  });

  it('disables the build button until something is selected', () => {
    const { rerender } = render(<UnroutedColumn {...BASE} />);
    expect(screen.getByRole('button', { name: 'Armar ruta' })).toBeDisabled();

    rerender(
      <UnroutedColumn
        {...BASE}
        selectedIds={new Set(['a1'])}
        summary={{
          groupCount: 1,
          orderCount: 62,
          packageCount: 148,
          comunaCount: 2,
          orderIds: ['o1'],
        }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Armar ruta' })).toBeEnabled();
  });

  it('summarises the selection in the footer, pluralising comunas', () => {
    render(
      <UnroutedColumn
        {...BASE}
        summary={{
          groupCount: 1,
          orderCount: 62,
          packageCount: 148,
          comunaCount: 1,
          orderIds: ['o1'],
        }}
      />,
    );
    expect(screen.getByText('62 seleccionadas / 148 paquetes · 1 comuna')).toBeInTheDocument();
  });

  it('shows an empty state when nothing is routable', () => {
    render(<UnroutedColumn {...BASE} groups={[]} />);
    expect(screen.getByText(/No hay órdenes listas para rutear/)).toBeInTheDocument();
  });
});
