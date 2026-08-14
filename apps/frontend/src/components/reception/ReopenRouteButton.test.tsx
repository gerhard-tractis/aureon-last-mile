import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

const mockMutate = vi.fn();
const hookState = { mutate: mockMutate, isPending: false };
vi.mock('@/hooks/reception/useReopenRouteReception', () => ({
  useReopenRouteReception: () => hookState,
}));

import { ReopenRouteButton } from './ReopenRouteButton';

describe('ReopenRouteButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookState.isPending = false;
  });

  it('renders nothing once any package has been received', () => {
    const { container } = render(
      <ReopenRouteButton routeId="r1" code="PR-2026-0001" receivedCount={1} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('button', { name: /reabrir/i })).not.toBeInTheDocument();
  });

  it('is visible while received_count is 0', () => {
    render(<ReopenRouteButton routeId="r1" code="PR-2026-0001" receivedCount={0} />);
    expect(screen.getByRole('button', { name: /reabrir ruta/i })).toBeInTheDocument();
  });

  it('does not call reopen_pickup_route until confirmed', async () => {
    const user = userEvent.setup();
    render(<ReopenRouteButton routeId="r1" code="PR-2026-0001" receivedCount={0} />);

    await user.click(screen.getByRole('button', { name: /reabrir ruta/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('PR-2026-0001');
    expect(mockMutate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /confirmar reapertura/i }));
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0][0]).toEqual({ routeId: 'r1' });
  });

  it('returns to the reception list on success', async () => {
    mockMutate.mockImplementation((_a, opts) => opts?.onSuccess?.());
    const user = userEvent.setup();
    render(<ReopenRouteButton routeId="r1" code="PR-2026-0001" receivedCount={0} />);

    await user.click(screen.getByRole('button', { name: /reabrir ruta/i }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: /confirmar reapertura/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/app/reception'));
  });

  it('surfaces the named replacement-route error legibly', async () => {
    mockMutate.mockImplementation((_a, opts) =>
      opts?.onError?.(
        new Error(
          'El conductor ya tiene una ruta de retiro activa (PR-2026-0009); ciérrela o anúlela antes de reabrir PR-2026-0001',
        ),
      ),
    );
    const user = userEvent.setup();
    render(<ReopenRouteButton routeId="r1" code="PR-2026-0001" receivedCount={0} />);

    await user.click(screen.getByRole('button', { name: /reabrir ruta/i }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: /confirmar reapertura/i }));

    expect(
      await screen.findByText(/ya tiene una ruta de retiro activa \(PR-2026-0009\)/),
    ).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
