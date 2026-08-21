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

  it('asks only for this operator, and never for the leader themselves', () => {
    render(<CrewSelect {...baseProps()} />);
    expect(mockUseCrewCandidates).toHaveBeenCalledWith('op-1', 'user-me');
  });

  it('renders every candidate as a toggle row named after the person', () => {
    render(<CrewSelect {...baseProps()} />);
    expect(screen.getByRole('checkbox', { name: 'Ana Pérez' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Bruno Díaz' })).toBeInTheDocument();
  });

  it('reflects which rows are already ticked', () => {
    render(<CrewSelect {...baseProps()} value={['crew-2']} />);
    expect(screen.getByRole('checkbox', { name: 'Bruno Díaz' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Ana Pérez' })).not.toBeChecked();
  });

  it('adds a person on tap', async () => {
    const onChange = vi.fn();
    render(<CrewSelect {...baseProps()} onChange={onChange} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Ana Pérez' }));
    expect(onChange).toHaveBeenCalledWith(['crew-1']);
  });

  it('removes a person on a second tap', async () => {
    const onChange = vi.fn();
    render(<CrewSelect {...baseProps()} value={['crew-1', 'crew-2']} onChange={onChange} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Ana Pérez' }));
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
    expect(screen.getByText('ACOMPAÑANTES · 2')).toBeInTheDocument();
  });

  it('counts zero, not the candidate list, when nothing is ticked', () => {
    render(<CrewSelect {...baseProps()} />);
    expect(screen.getByText('ACOMPAÑANTES · 0')).toBeInTheDocument();
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
    expect(screen.getByRole('checkbox', { name: 'Sin nombre' })).toBeInTheDocument();
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
});
