import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { EventsPanel } from './EventsPanel';

const defaultProps = {
  orderId: 'ord-123',
  onSimulate: vi.fn().mockResolvedValue(undefined),
  onStateEdit: vi.fn().mockResolvedValue(undefined),
  loading: false,
};

describe('EventsPanel', () => {
  it('buttons are disabled when orderId is null', () => {
    render(<EventsPanel {...defaultProps} orderId={null} />);
    const buttons = screen.getAllByRole('button');
    // Every button (except non-proactive ones) should be disabled
    buttons.forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });

  it('buttons are disabled when loading is true', () => {
    render(<EventsPanel {...defaultProps} loading={true} />);
    const buttons = screen.getAllByRole('button');
    buttons.forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });

  it('ETA button shows time input', () => {
    render(<EventsPanel {...defaultProps} />);
    const timeInput = screen.getByLabelText(/ETA time/i);
    expect(timeInput).toBeInTheDocument();
    expect((timeInput as HTMLInputElement).type).toBe('time');
  });

  it('Failed button shows reason dropdown', () => {
    render(<EventsPanel {...defaultProps} />);
    const select = screen.getByLabelText(/Fail reason/i);
    expect(select).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Not home' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'No access' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Customer unreachable' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Address invalid' })).toBeInTheDocument();
  });

  it('reactive input submit calls onSimulate with client_message', async () => {
    const user = userEvent.setup();
    const onSimulate = vi.fn().mockResolvedValue(undefined);
    render(<EventsPanel {...defaultProps} onSimulate={onSimulate} />);

    const input = screen.getByPlaceholderText(/Type customer message/i);
    await user.type(input, 'Is my order close?');
    await user.click(screen.getByRole('button', { name: /^Send$/ }));

    expect(onSimulate).toHaveBeenCalledWith('client_message', { body: 'Is my order close?' });
  });

  it('proactive event buttons fire onSimulate', async () => {
    const user = userEvent.setup();
    const onSimulate = vi.fn().mockResolvedValue(undefined);
    render(<EventsPanel {...defaultProps} onSimulate={onSimulate} />);

    await user.click(screen.getByRole('button', { name: 'Early Arrival' }));
    expect(onSimulate).toHaveBeenCalledWith('early_arrival', undefined);

    await user.click(screen.getByRole('button', { name: 'Pickup' }));
    expect(onSimulate).toHaveBeenCalledWith('pickup', undefined);

    await user.click(screen.getByRole('button', { name: 'Delivered' }));
    expect(onSimulate).toHaveBeenCalledWith('delivered', undefined);
  });
});
