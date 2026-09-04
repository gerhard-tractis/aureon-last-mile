import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoutePanel } from './RoutePanel';

const baseProps = {
  packageCount: 2,
  vehicles: [],
  selectedVehicle: '',
  driverName: '',
  dispatching: false,
  dispatchError: null,
  onVehicleChange: vi.fn(),
  onDriverChange: vi.fn(),
  onDispatch: vi.fn(),
  onRetry: vi.fn(),
  onDelete: vi.fn(),
};

/**
 * spec-70 phase 4, breakage #3: RoutePanel used to take a single `routeClosed`
 * boolean fabricated from local state. It now takes the route's real
 * `RouteStatus` and derives every affordance from it, so what the buttons
 * allow can never disagree with what the API accepts (LOADABLE_ROUTE_STATUSES
 * / 'loaded' are the same sets scan/seal/dispatch enforce server-side).
 */
describe('RoutePanel — derived from routeStatus', () => {
  /**
   * spec-75 phase 4, decision 4 — "Cerrar Ruta" (seal) is REMOVED from
   * this panel, at every status. Closing a route is crew-mobile only
   * (`2i`, spec-77); the three status-gated enable/disable tests that used
   * to live here (loading/loaded/empty-route) are replaced by this single
   * "never mounts" assertion, which is the honest replacement — there is
   * no status at which the button should exist any more.
   */
  it('never mounts a "Cerrar Ruta" action, at any route status', () => {
    render(<RoutePanel {...baseProps} routeStatus="loading" />);
    expect(screen.queryByRole('button', { name: /cerrar ruta/i })).not.toBeInTheDocument();
  });

  it('disables Despachar while the route is only "loading" — not yet sealed', () => {
    render(<RoutePanel {...baseProps} routeStatus="loading" selectedVehicle="T-1" />);
    expect(screen.getByRole('button', { name: /Despachar/ })).toBeDisabled();
  });

  /** The exact case spec-70 phase 4 names: Despachar unlocks at 'loaded', matching what /dispatch requires. */
  it('enables Despachar exactly when the route is loaded and a vehicle is selected', () => {
    render(<RoutePanel {...baseProps} routeStatus="loaded" selectedVehicle="T-1" />);
    expect(screen.getByRole('button', { name: /Despachar/ })).toBeEnabled();
  });

  it('keeps Despachar disabled at loaded without a vehicle selected', () => {
    render(<RoutePanel {...baseProps} routeStatus="loaded" selectedVehicle="" />);
    expect(screen.getByRole('button', { name: /Despachar/ })).toBeDisabled();
  });

  it('does not re-enable Despachar once the route has moved past loaded (dispatched)', () => {
    render(<RoutePanel {...baseProps} routeStatus="dispatched" selectedVehicle="T-1" />);
    expect(screen.getByRole('button', { name: /Despachar/ })).toBeDisabled();
  });

  /**
   * A sealed route still needs a truck picked. `selectedVehicle` lives in
   * React state, so a tablet reload after sealing comes back with nothing
   * selected — if the field were locked here, Despachar could never enable
   * and the route would be undispatchable from the UI with no way out.
   */
  it('keeps the vehicle/driver fields editable on a sealed route', () => {
    render(<RoutePanel {...baseProps} routeStatus="loaded" />);
    expect(screen.getByPlaceholderText('Nombre o RUT…')).toBeEnabled();
  });

  it('locks the vehicle/driver fields once the route has left', () => {
    render(<RoutePanel {...baseProps} routeStatus="dispatched" />);
    expect(screen.getByPlaceholderText('Nombre o RUT…')).toBeDisabled();
  });

  it('leaves the vehicle/driver fields editable while still loading', () => {
    render(<RoutePanel {...baseProps} routeStatus="loading" />);
    expect(screen.getByPlaceholderText('Nombre o RUT…')).toBeEnabled();
  });

  it('offers "Eliminar Ruta" for an open route (draft/planned/loading/loaded)', () => {
    render(<RoutePanel {...baseProps} routeStatus="loaded" />);
    expect(screen.getByRole('button', { name: 'Eliminar Ruta' })).toBeInTheDocument();
  });

  it('hides "Eliminar Ruta" once the route has been dispatched — the API refuses it', () => {
    render(<RoutePanel {...baseProps} routeStatus="dispatched" />);
    expect(screen.queryByRole('button', { name: 'Eliminar Ruta' })).not.toBeInTheDocument();
  });

  it('treats an unloaded routeStatus (still fetching) as not yet actionable, not as loadable', () => {
    render(<RoutePanel {...baseProps} routeStatus={undefined} packageCount={2} />);
    expect(screen.getByRole('button', { name: /Despachar/ })).toBeDisabled();
  });

  it('calls onDelete when confirmed', async () => {
    render(<RoutePanel {...baseProps} routeStatus="draft" />);
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar Ruta' }));
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    expect(baseProps.onDelete).toHaveBeenCalled();
  });
});
