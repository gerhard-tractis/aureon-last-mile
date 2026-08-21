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

  it('does not submit a blank code', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ManualCodeSheet open onOpenChange={vi.fn()} onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: /Registrar/i }));

    // Proves the mutation callback was never invoked, not merely that the
    // sheet stayed open — an empty submit must be a true no-op.
    expect(onSubmit).not.toHaveBeenCalled();
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
});
