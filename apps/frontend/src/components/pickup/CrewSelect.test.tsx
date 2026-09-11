import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CrewSelect } from './CrewSelect';

const mockUseCrewCandidates = vi.fn();
vi.mock('@/hooks/pickup/useCrewCandidates', () => ({
  useCrewCandidates: (...args: unknown[]) => mockUseCrewCandidates(...args),
}));

const CANDIDATES = [
  { id: 'crew-1', full_name: 'Ana Pérez', role: 'pickup_crew' },
  { id: 'crew-2', full_name: 'Bruno Díaz', role: 'pickup_leader' },
];

function baseProps() {
  return {
    operatorId: 'op-1',
    excludeUserId: 'user-me',
    value: [] as string[],
    onChange: vi.fn(),
  };
}

describe('CrewSelect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCrewCandidates.mockReturnValue({ data: CANDIDATES, isLoading: false });
  });

  // Threading only: this asserts the operator and the exclusion id REACH the
  // hook, not that anyone is actually excluded -- the hook is mocked here, so
  // it could not. The exclusion itself is tested against real rows in
  // useCrewCandidates.test.ts ("never offers the signed-in user as their own
  // crew"). Named for what it checks, so nobody reads coverage into it that
  // is not here.
  it('passes the operator and the exclusion id through to the hook', () => {
    render(<CrewSelect {...baseProps()} />);
    expect(mockUseCrewCandidates).toHaveBeenCalledWith('op-1', 'user-me');
  });

  it('renders every candidate as a toggle row named after the person', () => {
    render(<CrewSelect {...baseProps()} />);
    expect(screen.getByRole('checkbox', { name: 'Ana Pérez, auxiliar' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Bruno Díaz, conductor' })).toBeInTheDocument();
  });

  /**
   * Review round 1 (spec-95 fase 4) — `aria-label` REPLACES the accessible
   * name; it does not merge with the visible `<span>` role text next to it.
   * A screen reader user got the name and never the role, silently, because
   * `getByRole(..., { name: 'Ana Pérez' })` (above) kept matching an
   * aria-label that had simply never grown the role suffix. This asserts
   * the exact composed name so that regression fails here again, not just
   * by chance in the test above.
   */
  it('composes the accessible name out of the name AND the role, not just the visible span', () => {
    render(<CrewSelect {...baseProps()} />);
    expect(screen.queryByRole('checkbox', { name: 'Ana Pérez' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Ana Pérez, auxiliar' })).toBeInTheDocument();
  });

  it('reflects which rows are already ticked', () => {
    render(<CrewSelect {...baseProps()} value={['crew-2']} />);
    expect(screen.getByRole('checkbox', { name: 'Bruno Díaz, conductor' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Ana Pérez, auxiliar' })).not.toBeChecked();
  });

  it('adds a person on tap', async () => {
    const onChange = vi.fn();
    render(<CrewSelect {...baseProps()} onChange={onChange} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Ana Pérez, auxiliar' }));
    expect(onChange).toHaveBeenCalledWith(['crew-1']);
  });

  it('removes a person on a second tap', async () => {
    const onChange = vi.fn();
    render(<CrewSelect {...baseProps()} value={['crew-1', 'crew-2']} onChange={onChange} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Ana Pérez, auxiliar' }));
    expect(onChange).toHaveBeenCalledWith(['crew-2']);
  });

  /**
   * spec-61 Task 5, DECIDED 2026-08-21 — the label, asserted verbatim.
   *
   * `EQUIPO · N` belongs to 3h's PickupRouteCrewStrip and is leader-
   * INCLUSIVE (`crew.length + 1`). This counter is leader-EXCLUSIVE: the
   * leader is filtered out of the candidate list, so they can never be one
   * of the rows it counts. One trip therefore used to read `EQUIPO · 2`
   * here and `EQUIPO · 3` there — the same word standing for two
   * quantities. Asserting the exact string is what stops that returning
   * silently: a label reverted to `EQUIPO · 2` fails right here. A separate
   * `queryByText(/EQUIPO/)` assertion was dropped as redundant — it can only
   * fail in cases this one already catches.
   */
  it('counts the ticked rows under an ACOMPAÑANTES header, never EQUIPO', () => {
    render(<CrewSelect {...baseProps()} value={['crew-1', 'crew-2']} />);
    expect(screen.getByText('ACOMPAÑANTES')).toBeInTheDocument();
    expect(screen.getByText('2 de 2')).toBeInTheDocument();
  });

  // spec-95 fase 4 — el mock (`5b`) pide "N de M", no un conteo suelto: N
  // ticados sobre M candidatos totales, no sobre los seleccionados.
  it('counts as "N de M" against the full candidate roster, not a bare count', () => {
    render(<CrewSelect {...baseProps()} value={['crew-1']} />);
    expect(screen.getByText('1 de 2')).toBeInTheDocument();
  });

  it('counts zero, not the candidate list, when nothing is ticked', () => {
    render(<CrewSelect {...baseProps()} />);
    expect(screen.getByText('ACOMPAÑANTES')).toBeInTheDocument();
    expect(screen.getByText('0 de 2')).toBeInTheDocument();
  });

  // `users.full_name` is nullable. A row with no name is still a real person
  // the leader may need to take along, so it gets a labelled row rather than
  // a blank one — a checkbox with no accessible name is untappable by screen
  // reader and unreadable by eye.
  it('labels a nameless account instead of rendering a blank row', () => {
    mockUseCrewCandidates.mockReturnValue({
      data: [{ id: 'crew-3', full_name: null, role: 'pickup_crew' }],
      isLoading: false,
    });
    render(<CrewSelect {...baseProps()} />);
    expect(screen.getByRole('checkbox', { name: 'Sin nombre, auxiliar' })).toBeInTheDocument();
  });

  /**
   * spec-61 Task 5 — the list renders inside PickupMobileStartRoute's accent
   * card, ABOVE "Iniciar ruta de recogida", and useCrewCandidates fetches
   * every non-deleted pickup_crew/pickup_leader in the operator with no
   * limit. Twenty people is ~880px of rows, which pushed the primary CTA off
   * the bottom of a 390px screen. Every other test here uses one or two
   * rows, so nothing else in this file could have caught it.
   *
   * The assertion is on the CONTAINER's cap rather than on layout, because
   * jsdom computes no geometry — it would report 0px for everything and pass
   * against any implementation at all.
   */
  it('caps its own height instead of growing past the start button', () => {
    mockUseCrewCandidates.mockReturnValue({
      data: Array.from({ length: 20 }, (_, i) => ({
        id: `crew-${i}`,
        full_name: `Persona ${i}`,
        role: 'pickup_crew',
      })),
      isLoading: false,
    });
    render(<CrewSelect {...baseProps()} />);

    // All twenty are still present and reachable — the fix is scrolling, not
    // hiding people from the leader.
    expect(screen.getAllByRole('checkbox')).toHaveLength(20);
    expect(screen.getByRole('checkbox', { name: 'Persona 19, auxiliar' })).toBeInTheDocument();

    const list = screen.getByRole('checkbox', { name: 'Persona 0, auxiliar' }).parentElement!;
    expect(list.className).toContain('max-h-[45vh]');
    expect(list.className).toContain('overflow-y-auto');
  });

  // spec-95 fase 4 — el mock (`5b`) muestra el rol de cada persona a la
  // derecha de su fila: pickup_crew -> "auxiliar", pickup_leader/ops_leader
  // -> "conductor". El campo `role` ya viaja en CrewCandidate
  // (useCrewCandidates.ts:6, seleccionado en :31); esto sólo lo traduce.
  it("shows each person's role, translated, at the right of their row", () => {
    render(<CrewSelect {...baseProps()} />);
    expect(screen.getByText('auxiliar')).toBeInTheDocument();
    expect(screen.getByText('conductor')).toBeInTheDocument();
  });

  it('translates ops_leader to conductor as well, same as pickup_leader', () => {
    mockUseCrewCandidates.mockReturnValue({
      data: [{ id: 'crew-4', full_name: 'Coni Leiva', role: 'ops_leader' }],
      isLoading: false,
    });
    render(<CrewSelect {...baseProps()} />);
    expect(screen.getByText('conductor')).toBeInTheDocument();
  });

  it('says the roster is empty when nobody else is registered', () => {
    mockUseCrewCandidates.mockReturnValue({ data: [], isLoading: false });
    render(<CrewSelect {...baseProps()} />);
    expect(screen.getByText('No hay compañeros registrados')).toBeInTheDocument();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  // Without the loading branch the empty message appears for a beat on every
  // cold load and tells the leader a lie about their own team.
  it('does not claim an empty roster while the query is still running', () => {
    mockUseCrewCandidates.mockReturnValue({ data: undefined, isLoading: true });
    render(<CrewSelect {...baseProps()} />);
    expect(screen.queryByText('No hay compañeros registrados')).toBeNull();
  });

  // Review round 1 (spec-95 fase 4) — the counter used to render OUTSIDE the
  // `isLoading` branch, off `rows = candidates ?? []`. While loading it read
  // "0 de 0" directly above a body that says "Cargando compañeros…" — a
  // number promising an empty roster next to a message saying the opposite.
  it('shows a dash, not "0 de 0", while candidates are still loading', () => {
    mockUseCrewCandidates.mockReturnValue({ data: undefined, isLoading: true });
    render(<CrewSelect {...baseProps()} />);
    expect(screen.queryByText('0 de 0')).toBeNull();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  /**
   * Review round 1 (spec-95 fase 4) — `value` is state the PARENT owns;
   * `rows` comes from a query with a 5-minute `staleTime`. If a ticked
   * person is soft-deleted or has their role changed elsewhere while this
   * screen sits open, the next refetch drops them from `rows` but `value`
   * still carries their id — the counter would read "2 de 1" and that
   * stale id would still ride along to `start_pickup_route`. CrewSelect
   * prunes `value` against the fetched roster instead of just capping the
   * DISPLAYED count, because the id leaving `rows` means the person is no
   * longer a valid crew member, not just a display glitch.
   */
  it('drops a ticked id that no longer exists in the fetched roster', () => {
    const onChange = vi.fn();
    render(<CrewSelect {...baseProps()} value={['crew-1', 'ghost-id']} onChange={onChange} />);
    expect(onChange).toHaveBeenCalledWith(['crew-1']);
  });

  it('leaves onChange untouched when every ticked id is still in the roster', () => {
    const onChange = vi.fn();
    render(<CrewSelect {...baseProps()} value={['crew-1', 'crew-2']} onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
  });

  // Pruning against an incomplete roster (candidates still `undefined`
  // while loading) would wipe out every ticked id on first render, before
  // the real data ever arrives.
  it('does not prune anything while candidates are still loading', () => {
    mockUseCrewCandidates.mockReturnValue({ data: undefined, isLoading: true });
    const onChange = vi.fn();
    render(<CrewSelect {...baseProps()} value={['crew-1']} onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
  });
});
