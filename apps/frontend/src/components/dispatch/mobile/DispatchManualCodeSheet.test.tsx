import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DispatchManualCodeSheet } from './DispatchManualCodeSheet';

/**
 * Renders the sheet the way it is really used — behind a trigger button,
 * not force-mounted open — so closing it has somewhere real for Radix's
 * own focus-return behaviour to land.
 */
function Harness({ onSubmit }: { onSubmit: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Ingresar código
      </button>
      <DispatchManualCodeSheet open={open} onOpenChange={setOpen} onSubmit={onSubmit} />
    </>
  );
}

describe('DispatchManualCodeSheet', () => {
  it('spec-76 2f — a typed code submits through the same onSubmit the scanner uses, trimmed', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onOpenChange = vi.fn();
    render(<DispatchManualCodeSheet open onOpenChange={onOpenChange} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('Código del bulto'), '  CL8841873  ');
    await user.click(screen.getByRole('button', { name: /registrar/i }));

    expect(onSubmit).toHaveBeenCalledWith('CL8841873');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('an all-blank code is a silent no-op — no mutation, sheet stays open', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onOpenChange = vi.fn();
    render(<DispatchManualCodeSheet open onOpenChange={onOpenChange} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('Código del bulto'), '   ');
    await user.click(screen.getByRole('button', { name: /registrar/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('spec-76 review — closing after a submit does not trap focus inside the now-removed sheet', async () => {
    // jsdom cannot fully exercise Radix's own focus-restore-to-trigger
    // behaviour (it depends on real browser focus/animation timing this
    // environment does not simulate), so this proves what jsdom CAN prove
    // honestly: the sheet's content actually unmounts on submit (this
    // component adds no refocus logic of its own — see its doc comment —
    // so a focus trap left behind here would be a real, silent bug: a
    // scanner gun typing into a removed, invisible input).
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    const trigger = screen.getByRole('button', { name: 'Ingresar código' });
    await user.click(trigger);
    const input = screen.getByLabelText('Código del bulto');
    await user.type(input, 'CL7000');
    await user.click(screen.getByRole('button', { name: /registrar/i }));

    expect(onSubmit).toHaveBeenCalledWith('CL7000');
    await waitFor(() => expect(screen.queryByLabelText('Código del bulto')).not.toBeInTheDocument());
    expect(document.activeElement).not.toBe(input);
  });
});
