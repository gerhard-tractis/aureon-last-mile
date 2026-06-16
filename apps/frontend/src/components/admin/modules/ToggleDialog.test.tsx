import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ToggleDialog } from './ToggleDialog';
import { ModuleKey } from '@/lib/modules/registry';

const enable = vi.fn();
const disable = vi.fn();
vi.mock('./actions', () => ({
  enableModule: (...a: unknown[]) => enable(...a),
  disableModule: (...a: unknown[]) => disable(...a),
}));

beforeEach(() => {
  enable.mockReset();
  disable.mockReset();
});

describe('ToggleDialog (spec-45)', () => {
  it('blocks submit with empty reason', () => {
    render(
      <ToggleDialog
        operatorId="op-1"
        moduleKey={ModuleKey.PICKUP}
        currentlyEnabled={false}
        onClose={() => {}}
      />,
    );
    const submit = screen.getByRole('button', { name: /confirm/i });
    expect(submit).toBeDisabled();
  });

  it('calls enableModule with reason when currently disabled', async () => {
    enable.mockResolvedValue(undefined);
    render(
      <ToggleDialog
        operatorId="op-1"
        moduleKey={ModuleKey.PICKUP}
        currentlyEnabled={false}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'phase-1 go-live' },
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() =>
      expect(enable).toHaveBeenCalledWith('op-1', 'pickup', 'phase-1 go-live'),
    );
  });

  it('calls disableModule when currently enabled', async () => {
    disable.mockResolvedValue(undefined);
    render(
      <ToggleDialog
        operatorId="op-1"
        moduleKey={ModuleKey.PICKUP}
        currentlyEnabled={true}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'rolling back' },
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() =>
      expect(disable).toHaveBeenCalledWith('op-1', 'pickup', 'rolling back'),
    );
  });
});
