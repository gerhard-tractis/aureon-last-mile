import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FinalizeReceptionButton } from './FinalizeReceptionButton';

const finalize = () => screen.getByRole('button', { name: /finalizar recepción/i });

describe('FinalizeReceptionButton', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is disabled when receivedCount is zero', () => {
    render(
      <FinalizeReceptionButton
        receivedCount={0}
        expectedCount={5}
        unexpectedCount={0}
        onFinalize={vi.fn()}
      />,
    );
    expect(finalize()).toBeDisabled();
  });

  it('finalises directly with null notes only when matched === expected AND unexpected === 0', async () => {
    const onFinalize = vi.fn();
    const user = userEvent.setup();
    render(
      <FinalizeReceptionButton
        receivedCount={5}
        expectedCount={5}
        unexpectedCount={0}
        onFinalize={onFinalize}
      />,
    );
    await user.click(finalize());
    expect(onFinalize).toHaveBeenCalledWith(null);
  });

  it('opens discrepancy modal on UNDER-count (3 received / 5 expected / 0 unexpected)', async () => {
    const user = userEvent.setup();
    render(
      <FinalizeReceptionButton
        receivedCount={3}
        expectedCount={5}
        unexpectedCount={0}
        onFinalize={vi.fn()}
      />,
    );
    await user.click(finalize());
    expect(await screen.findByTestId('discrepancy-notes-input')).toBeInTheDocument();
    expect(screen.getByText(/Faltan 2 paquetes/)).toBeInTheDocument();
  });

  it('opens discrepancy modal on OVER-count (6 received / 5 expected / 1 unexpected)', async () => {
    const onFinalize = vi.fn();
    const user = userEvent.setup();
    render(
      <FinalizeReceptionButton
        receivedCount={6}
        expectedCount={5}
        unexpectedCount={1}
        onFinalize={onFinalize}
      />,
    );
    await user.click(finalize());
    expect(await screen.findByTestId('discrepancy-notes-input')).toBeInTheDocument();
    expect(screen.getByText(/1 paquete inesperado/)).toBeInTheDocument();
    expect(onFinalize).not.toHaveBeenCalled();
  });

  // =====================================================================
  // THE OFFSETTING CASE — the whole reason this rule exists.
  //
  // 10 expected · 10 received · 1 unexpected. A naive `received !== expected`
  // sees 10 === 10 and demands nothing — yet an expected package was left
  // behind at a client AND a package from another truck was loaded. Two
  // errors cancelling out is the single most likely real-world shape, and
  // it is exactly what the discrepancy report exists to catch.
  //
  // If this test passes while the rule is `receivedCount < expectedCount`,
  // it is not testing what it claims to.
  // =====================================================================
  it('OFFSETTING CASE: demands notes at 10 expected / 10 received / 1 unexpected, where a naive received-vs-expected check would wave it through', async () => {
    const onFinalize = vi.fn();
    const user = userEvent.setup();
    render(
      <FinalizeReceptionButton
        receivedCount={10}
        expectedCount={10}
        unexpectedCount={1}
        onFinalize={onFinalize}
      />,
    );
    await user.click(finalize());

    // No silent finalisation.
    expect(onFinalize).not.toHaveBeenCalled();
    // The modal opened and names BOTH halves of the discrepancy.
    expect(await screen.findByTestId('discrepancy-notes-input')).toBeInTheDocument();
    expect(screen.getByText(/Falta 1 paquete/)).toBeInTheDocument();
    expect(screen.getByText(/1 paquete inesperado/)).toBeInTheDocument();

    await user.type(screen.getByTestId('discrepancy-notes-input'), 'uno de otro camión');
    await user.click(screen.getByTestId('confirm-finalize'));
    expect(onFinalize).toHaveBeenCalledWith('uno de otro camión');
  });

  it('gates confirm button until notes are entered', async () => {
    const onFinalize = vi.fn();
    const user = userEvent.setup();
    render(
      <FinalizeReceptionButton
        receivedCount={3}
        expectedCount={5}
        unexpectedCount={0}
        onFinalize={onFinalize}
      />,
    );
    await user.click(finalize());

    const confirm = screen.getByTestId('confirm-finalize');
    expect(confirm).toBeDisabled();

    await user.type(screen.getByTestId('discrepancy-notes-input'), 'falta un paquete');
    expect(confirm).not.toBeDisabled();

    await user.click(confirm);
    expect(onFinalize).toHaveBeenCalledWith('falta un paquete');
  });
});
