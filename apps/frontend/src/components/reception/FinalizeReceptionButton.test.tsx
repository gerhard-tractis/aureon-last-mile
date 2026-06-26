import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FinalizeReceptionButton } from './FinalizeReceptionButton';

describe('FinalizeReceptionButton', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is disabled when receivedCount is zero', () => {
    render(
      <FinalizeReceptionButton
        receivedCount={0}
        expectedCount={5}
        onFinalize={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /finalizar recepción/i })).toBeDisabled();
  });

  it('finalises directly with null notes when received equals expected', async () => {
    const onFinalize = vi.fn();
    const user = userEvent.setup();
    render(
      <FinalizeReceptionButton
        receivedCount={5}
        expectedCount={5}
        onFinalize={onFinalize}
      />,
    );
    await user.click(screen.getByRole('button', { name: /finalizar recepción/i }));
    expect(onFinalize).toHaveBeenCalledWith(null);
  });

  it('opens discrepancy modal when received < expected', async () => {
    const user = userEvent.setup();
    render(
      <FinalizeReceptionButton
        receivedCount={3}
        expectedCount={5}
        onFinalize={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /finalizar recepción/i }));
    expect(await screen.findByText(/recepción incompleta/i)).toBeInTheDocument();
    expect(screen.getByText(/Faltan 2 paquetes/)).toBeInTheDocument();
  });

  it('gates confirm button until notes are entered', async () => {
    const onFinalize = vi.fn();
    const user = userEvent.setup();
    render(
      <FinalizeReceptionButton
        receivedCount={3}
        expectedCount={5}
        onFinalize={onFinalize}
      />,
    );
    await user.click(screen.getByRole('button', { name: /finalizar recepción/i }));

    const confirm = screen.getByTestId('confirm-finalize');
    expect(confirm).toBeDisabled();

    await user.type(screen.getByTestId('discrepancy-notes-input'), 'falta un paquete');
    expect(confirm).not.toBeDisabled();

    await user.click(confirm);
    expect(onFinalize).toHaveBeenCalledWith('falta un paquete');
  });
});
