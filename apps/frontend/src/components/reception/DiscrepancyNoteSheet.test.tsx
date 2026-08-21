import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DiscrepancyNoteSheet } from './DiscrepancyNoteSheet';

// 86 received - 1 unexpected = 85 matched against 88 expected -> 3 missing.
// unexpectedCount is deliberately non-zero: a fixture with unexpectedCount: 0
// would pass even if `missing` were wrongly computed as expected - received.
const counts = { expectedCount: 88, receivedCount: 86, unexpectedCount: 1 };

describe('DiscrepancyNoteSheet', () => {
  it('names the actual gap (3 missing), not the raw expected-minus-received offset, and calls out the ajeno', () => {
    render(
      <DiscrepancyNoteSheet
        open
        onOpenChange={vi.fn()}
        counts={counts}
        isPending={false}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText(/3/)).toBeInTheDocument();
    expect(screen.getByText(/ajeno/i)).toBeInTheDocument();
  });

  it('does not close on empty text', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <DiscrepancyNoteSheet
        open
        onOpenChange={vi.fn()}
        counts={counts}
        isPending={false}
        onConfirm={onConfirm}
      />,
    );

    const confirmButton = screen.getByRole('button', { name: /Cerrar recepción/i });
    expect(confirmButton).toBeDisabled();

    // A disabled button already blocks the click in the DOM; this also
    // proves onConfirm was never wired to fire regardless.
    await user.click(confirmButton);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('submits the trimmed note on confirm', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <DiscrepancyNoteSheet
        open
        onOpenChange={vi.fn()}
        counts={counts}
        isPending={false}
        onConfirm={onConfirm}
      />,
    );

    await user.type(screen.getByRole('textbox'), '  Faltan 3 de CARGA-99814  ');
    await user.click(screen.getByRole('button', { name: /Cerrar recepción/i }));

    expect(onConfirm).toHaveBeenCalledWith('Faltan 3 de CARGA-99814');
  });

  it('keeps Enter as a newline in the textarea instead of submitting — unlike ManualCodeSheet', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <DiscrepancyNoteSheet
        open
        onOpenChange={vi.fn()}
        counts={counts}
        isPending={false}
        onConfirm={onConfirm}
      />,
    );

    await user.type(screen.getByRole('textbox'), 'Faltan 3{Enter}revisar mañana');

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('Faltan 3\nrevisar mañana');
  });

  it('disables the confirm button while isPending, even with text typed', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <DiscrepancyNoteSheet
        open
        onOpenChange={vi.fn()}
        counts={counts}
        isPending
        onConfirm={onConfirm}
      />,
    );

    await user.type(screen.getByRole('textbox'), 'Faltan 3');

    expect(screen.getByRole('button', { name: /Cerrar recepción/i })).toBeDisabled();
  });
});
