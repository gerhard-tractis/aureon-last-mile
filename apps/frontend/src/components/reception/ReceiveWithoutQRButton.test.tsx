import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

const mockMutate = vi.fn();
const hookState = { mutate: mockMutate, isPending: false };
vi.mock('@/hooks/reception/useOpenRouteReception', () => ({
  useOpenRouteReception: () => hookState,
}));

import { ReceiveWithoutQRButton } from './ReceiveWithoutQRButton';

describe('ReceiveWithoutQRButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookState.isPending = false;
  });

  it('does not call open_route_reception on mount', () => {
    render(<ReceiveWithoutQRButton routeId="r1" code="PR-2026-0001" plate="AAA-111" />);
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('opens a confirmation dialog naming the route code and plate, without calling anything', async () => {
    const user = userEvent.setup();
    render(<ReceiveWithoutQRButton routeId="r1" code="PR-2026-0001" plate="AAA-111" />);

    await user.click(screen.getByRole('button', { name: /recibir sin qr/i }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('PR-2026-0001');
    expect(dialog).toHaveTextContent('AAA-111');
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('calls open_route_reception only after the dialog is confirmed', async () => {
    const user = userEvent.setup();
    render(<ReceiveWithoutQRButton routeId="r1" code="PR-2026-0001" plate="AAA-111" />);

    await user.click(screen.getByRole('button', { name: /recibir sin qr/i }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: /confirmar recepción/i }));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0][0]).toEqual({ routeId: 'r1' });
  });

  it('cancelling the dialog calls nothing', async () => {
    const user = userEvent.setup();
    render(<ReceiveWithoutQRButton routeId="r1" code="PR-2026-0001" plate="AAA-111" />);

    await user.click(screen.getByRole('button', { name: /recibir sin qr/i }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: /^cancelar$/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('navigates to the reception session on success', async () => {
    mockMutate.mockImplementation((_args, opts) => opts?.onSuccess?.());
    const user = userEvent.setup();
    render(<ReceiveWithoutQRButton routeId="r1" code="PR-2026-0001" plate="AAA-111" />);

    await user.click(screen.getByRole('button', { name: /recibir sin qr/i }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: /confirmar recepción/i }));

    expect(mockPush).toHaveBeenCalledWith('/app/reception/route/r1');
  });

  it('surfaces the RPC error in the dialog', async () => {
    mockMutate.mockImplementation((_args, opts) =>
      opts?.onError?.(new Error('La ruta PR-2026-0001 fue anulada y no puede recibirse')),
    );
    const user = userEvent.setup();
    render(<ReceiveWithoutQRButton routeId="r1" code="PR-2026-0001" plate="AAA-111" />);

    await user.click(screen.getByRole('button', { name: /recibir sin qr/i }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: /confirmar recepción/i }));

    expect(
      await screen.findByText(/fue anulada y no puede recibirse/),
    ).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('falls back to a placeholder when the route has no plate', async () => {
    const user = userEvent.setup();
    render(<ReceiveWithoutQRButton routeId="r1" code="PR-2026-0001" plate={null} />);

    await user.click(screen.getByRole('button', { name: /recibir sin qr/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/sin patente/i);
  });
});
