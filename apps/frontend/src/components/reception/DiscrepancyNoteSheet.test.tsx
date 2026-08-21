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

    expect(screen.getByText(/faltan 3 paquetes/)).toBeInTheDocument();
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

  it('asks about the ajeno, not a loss, when nothing is missing but an ajeno still forced the note open', () => {
    // 11 received - 1 ajeno = 10 matched against 10 expected -> missing is 0.
    // needsNote is still true because unexpectedCount > 0: the sheet must
    // name the ajeno as the reason, not talk about "paquetes faltantes"
    // that never happened.
    const noLossCounts = { expectedCount: 10, receivedCount: 11, unexpectedCount: 1 };
    render(
      <DiscrepancyNoteSheet
        open
        onOpenChange={vi.fn()}
        counts={noLossCounts}
        isPending={false}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.queryByText(/faltan?/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/Describe el paquete ajeno para cerrar la recepción/),
    ).toBeInTheDocument();

    // Same defect, one field down: the placeholder sits under the cursor,
    // so it must not contradict the description above it by talking about
    // "paquetes faltantes" that never happened.
    expect(screen.getByRole('textbox')).not.toHaveAttribute(
      'placeholder',
      expect.stringContaining('faltantes'),
    );
  });

  it('uses singular "falta" (not "faltan") when exactly one package is missing', () => {
    const oneMissingCounts = { expectedCount: 5, receivedCount: 4, unexpectedCount: 0 };
    render(
      <DiscrepancyNoteSheet
        open
        onOpenChange={vi.fn()}
        counts={oneMissingCounts}
        isPending={false}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText(/falta 1 paquete/)).toBeInTheDocument();
    expect(screen.queryByText(/faltan 1/)).not.toBeInTheDocument();
  });

  it('surfaces packages matched beyond what was expected instead of dropping them silently', () => {
    // 8 received - 1 ajeno = 7 matched against 5 expected -> missing clamps
    // to 0, but 2 boxes matched that were never expected. Losing this to
    // Math.max(0, ...) would leave the operator with no explanation for the
    // surplus while still being forced to write a note.
    const surplusCounts = { expectedCount: 5, receivedCount: 8, unexpectedCount: 1 };
    render(
      <DiscrepancyNoteSheet
        open
        onOpenChange={vi.fn()}
        counts={surplusCounts}
        isPending={false}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText(/sobran 2 paquetes/)).toBeInTheDocument();
  });
});
