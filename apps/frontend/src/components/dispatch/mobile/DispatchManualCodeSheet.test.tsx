import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DispatchManualCodeSheet } from './DispatchManualCodeSheet';

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
});
