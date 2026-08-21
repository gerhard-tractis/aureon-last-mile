import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ManualCodeSheet } from './ManualCodeSheet';

describe('ManualCodeSheet', () => {
  it('submits the code and closes', async () => {
    const onSubmit = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<ManualCodeSheet open onOpenChange={onOpenChange} onSubmit={onSubmit} />);

    await user.type(screen.getByRole('textbox', { name: /código/i }), 'CL7742891088');
    await user.click(screen.getByRole('button', { name: /Registrar/i }));

    expect(onSubmit).toHaveBeenCalledWith('CL7742891088');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('submits on Enter, not only via the button — the operator is typing one-handed', async () => {
    const onSubmit = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<ManualCodeSheet open onOpenChange={onOpenChange} onSubmit={onSubmit} />);

    await user.type(
      screen.getByRole('textbox', { name: /código/i }),
      'CL7742891088{Enter}',
    );

    expect(onSubmit).toHaveBeenCalledWith('CL7742891088');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not submit a blank code, and leaves the sheet open', async () => {
    const onSubmit = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<ManualCodeSheet open onOpenChange={onOpenChange} onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: /Registrar/i }));

    // Proves the mutation callback was never invoked, and that closing
    // wasn't hoisted above the empty-code guard — an empty submit must be
    // a true no-op: no mutation, no toast, no state change.
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('trims whitespace on both sides — a phone keyboard adds it constantly', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ManualCodeSheet open onOpenChange={vi.fn()} onSubmit={onSubmit} />);

    await user.type(screen.getByRole('textbox', { name: /código/i }), '  CL774  ');
    await user.click(screen.getByRole('button', { name: /Registrar/i }));

    expect(onSubmit).toHaveBeenCalledWith('CL774');
  });

  it('clears the field between opens, so the previous box code is not left behind', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <ManualCodeSheet open onOpenChange={vi.fn()} onSubmit={onSubmit} />,
    );

    await user.type(screen.getByRole('textbox', { name: /código/i }), 'CL7742891088');

    // Close, then reopen — simulates the sheet being dismissed and the
    // receptionist opening it again for the next box.
    rerender(<ManualCodeSheet open={false} onOpenChange={vi.fn()} onSubmit={onSubmit} />);
    rerender(<ManualCodeSheet open onOpenChange={vi.fn()} onSubmit={onSubmit} />);

    expect(screen.getByRole('textbox', { name: /código/i })).toHaveValue('');
  });

  it('marks the field for all-caps input, since the barcodes are upper-case', () => {
    render(<ManualCodeSheet open onOpenChange={vi.fn()} onSubmit={vi.fn()} />);

    expect(screen.getByRole('textbox', { name: /código/i })).toHaveAttribute(
      'autocapitalize',
      'characters',
    );
  });
});
