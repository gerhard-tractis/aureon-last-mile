import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PickupRouteCrewStrip } from './PickupRouteCrewStrip';

function names() {
  return screen.getAllByTestId('crew-member').map((n) => n.textContent ?? '');
}

describe('PickupRouteCrewStrip', () => {
  it('names the leader first, then the crew in order', () => {
    render(
      <PickupRouteCrewStrip
        driverName="M. Rojas"
        crew={[
          { user_id: 'u1', full_name: 'Ana Pérez' },
          { user_id: 'u2', full_name: 'Luis Soto' },
        ]}
      />,
    );
    const rendered = names();
    expect(rendered).toHaveLength(3);
    expect(rendered[0]).toContain('M. Rojas');
    expect(rendered[1]).toContain('Ana Pérez');
    expect(rendered[2]).toContain('Luis Soto');
  });

  it('marks the leader, and only the leader', () => {
    render(
      <PickupRouteCrewStrip
        driverName="M. Rojas"
        crew={[
          { user_id: 'u1', full_name: 'Ana Pérez' },
          { user_id: 'u2', full_name: 'Luis Soto' },
        ]}
      />,
    );
    const marked = names().filter((t) => /líder/i.test(t));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain('M. Rojas');
  });

  it('counts everyone on the trip, leader included', () => {
    render(
      <PickupRouteCrewStrip
        driverName="M. Rojas"
        crew={[
          { user_id: 'u1', full_name: 'Ana Pérez' },
          { user_id: 'u2', full_name: 'Luis Soto' },
        ]}
      />,
    );
    expect(screen.getByText('EQUIPO · 3')).toBeInTheDocument();
  });

  it('renders nothing for a solo route rather than an empty header', () => {
    const { container } = render(<PickupRouteCrewStrip driverName="M. Rojas" crew={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  // The crew is fixed once the route opens (spec-61 Decision 1). No edit
  // path here: adding one would need a second RPC and an answer to "what
  // happens to the loads they already scanned". This is a guard against a
  // future edit path, not a test of present behaviour.
  it('offers no way to add or remove anyone', () => {
    const { container } = render(
      <PickupRouteCrewStrip
        driverName="M. Rojas"
        crew={[{ user_id: 'u1', full_name: 'Ana Pérez' }]}
      />,
    );
    // Load-bearing: without it the affordance check below passes against an
    // empty container, so it would hold even if the strip never rendered.
    expect(names()).toHaveLength(2);
    expect(container.querySelectorAll('button, a, input, select, textarea')).toHaveLength(0);
  });

  // `full_name` is null when the user row is soft-deleted: the RPC's LEFT
  // JOIN on `users` survives RLS's `deleted_at IS NULL` filter, so the seat
  // still comes back — with no name. That person is still on the trip and
  // must still occupy a chip.
  it('keeps a soft-deleted member on the strip under a placeholder, never an id', () => {
    render(
      <PickupRouteCrewStrip
        driverName={null}
        crew={[
          { user_id: 'u1', full_name: null },
          { user_id: 'u2', full_name: 'Luis Soto' },
        ]}
      />,
    );
    const rendered = names();
    expect(rendered).toHaveLength(3);
    expect(rendered[0]).toContain('Sin nombre');
    expect(rendered[1]).toContain('Sin nombre');
    expect(rendered[2]).toContain('Luis Soto');
    expect(screen.queryByText('u1')).toBeNull();
  });
});
