import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CancelRouteButton } from './CancelRouteButton';

const mockMutateAsync = vi.fn();
const mockUseCancelPickupRoute = vi.fn();
vi.mock('@/hooks/pickup/useCancelPickupRoute', () => ({
  useCancelPickupRoute: (...args: unknown[]) => {
    mockUseCancelPickupRoute(...args);
    return { mutateAsync: mockMutateAsync, isPending: false };
  },
}));

const mockToastError = vi.fn();
vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args) },
}));

function baseProps() {
  return { routeId: 'route-1', operatorId: 'op-1', onCancelled: vi.fn() };
}

const OPEN_CONFIRM = { name: /cancelar ruta/i };
const CONFIRM = { name: /sí, cancelar la ruta/i };

describe('CancelRouteButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue({ id: 'route-1', status: 'cancelled' });
  });

  /**
   * spec-61 Task 5 — "Confirm before firing. The cancel must not be a single
   * stray tap next to Cerrar ruta." Cancelling detaches every manifest on the
   * route, and this control lives one thumb-width from the button that ends
   * the day's work properly.
   */
  it('does not cancel anything on the first tap', async () => {
    render(<CancelRouteButton {...baseProps()} />);
    await userEvent.click(screen.getByRole('button', OPEN_CONFIRM));
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  /**
   * spec-61 Task 5 — "Say what happens in the confirm: the loads go back to
   * the pending list and any scanning progress on this route stops counting.
   * Do not make the leader infer it." Two separate assertions because they
   * are two separate consequences: deleting either sentence must fail.
   */
  it('says the loads return to the pending list', async () => {
    render(<CancelRouteButton {...baseProps()} />);
    await userEvent.click(screen.getByRole('button', OPEN_CONFIRM));
    expect(screen.getByText(/vuelven a la lista de pendientes/i)).toBeInTheDocument();
  });

  it('says the scanning progress on this route stops counting', async () => {
    render(<CancelRouteButton {...baseProps()} />);
    await userEvent.click(screen.getByRole('button', OPEN_CONFIRM));
    expect(screen.getByText(/deja de contar/i)).toBeInTheDocument();
  });

  it('cancels this route, and only this route, once confirmed', async () => {
    render(<CancelRouteButton {...baseProps()} />);
    await userEvent.click(screen.getByRole('button', OPEN_CONFIRM));
    await userEvent.click(screen.getByRole('button', CONFIRM));
    expect(mockMutateAsync).toHaveBeenCalledWith({ routeId: 'route-1' });
  });

  it('scopes the mutation to the operator', () => {
    render(<CancelRouteButton {...baseProps()} />);
    expect(mockUseCancelPickupRoute).toHaveBeenCalledWith('op-1');
  });

  it('backing out of the confirm cancels nothing', async () => {
    render(<CancelRouteButton {...baseProps()} />);
    await userEvent.click(screen.getByRole('button', OPEN_CONFIRM));
    await userEvent.click(screen.getByRole('button', { name: /^volver$/i }));
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('tells the caller once the route is really gone', async () => {
    const onCancelled = vi.fn();
    render(<CancelRouteButton {...baseProps()} onCancelled={onCancelled} />);
    await userEvent.click(screen.getByRole('button', OPEN_CONFIRM));
    await userEvent.click(screen.getByRole('button', CONFIRM));
    expect(onCancelled).toHaveBeenCalled();
  });

  // A rejected mutateAsync is an unhandled rejection unless it is caught.
  // More importantly the leader must be told: the route is still open and
  // their loads are still locked away from everyone else.
  it('surfaces a refusal instead of pretending the route was cancelled', async () => {
    mockMutateAsync.mockRejectedValue(new Error('cannot cancel route in status closed'));
    const onCancelled = vi.fn();
    render(<CancelRouteButton {...baseProps()} onCancelled={onCancelled} />);
    await userEvent.click(screen.getByRole('button', OPEN_CONFIRM));
    await userEvent.click(screen.getByRole('button', CONFIRM));
    expect(mockToastError).toHaveBeenCalledWith('cannot cancel route in status closed');
    expect(onCancelled).not.toHaveBeenCalled();
  });
});
