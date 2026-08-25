import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { StateEditModal } from './StateEditModal';

const defaultProps = {
  table: 'orders' as const,
  onClose: vi.fn(),
  onSubmit: vi.fn().mockResolvedValue(undefined),
};

describe('StateEditModal', () => {
  it('renders as a dialog', () => {
    render(<StateEditModal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows orders fields', () => {
    render(<StateEditModal {...defaultProps} table="orders" />);
    expect(screen.getByLabelText(/Customer Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Customer Phone/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Delivery Date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Window Start/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Window End/i)).toBeInTheDocument();
  });

  it('shows assignments status dropdown with all options', () => {
    render(<StateEditModal {...defaultProps} table="assignments" />);
    expect(screen.getByLabelText(/Status/i)).toBeInTheDocument();
    for (const status of ['pending', 'accepted', 'in_transit', 'delivered', 'failed']) {
      expect(screen.getByRole('option', { name: status })).toBeInTheDocument();
    }
  });

  it('shows dispatches fields', () => {
    render(<StateEditModal {...defaultProps} table="dispatches" />);
    expect(screen.getByLabelText(/Estimated At/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Status/i)).toBeInTheDocument();
  });

  it('submits only non-empty fields', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<StateEditModal {...defaultProps} table="orders" onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/Customer Name/i), 'Ana Lima');
    await user.click(screen.getByRole('button', { name: /Save/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ customer_name: 'Ana Lima' });
    });
  });

  it('calls onClose after successful submit', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<StateEditModal {...defaultProps} onClose={onClose} onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: /Save/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows error message when onSubmit rejects', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error('State edit failed (500)'));
    render(<StateEditModal {...defaultProps} onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: /Save/i }));

    await waitFor(() => {
      expect(screen.getByText(/State edit failed \(500\)/i)).toBeInTheDocument();
    });
  });

  it('disables Save button while loading', async () => {
    const user = userEvent.setup();
    let resolve: () => void;
    const onSubmit = vi.fn().mockImplementation(
      () => new Promise<void>((r) => { resolve = r; }),
    );
    render(<StateEditModal {...defaultProps} onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: /Save/i }));

    expect(screen.getByRole('button', { name: /Saving/i })).toBeDisabled();
    resolve!();
  });

  it('calls onClose when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<StateEditModal {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: /Cancel/i }));

    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when × button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<StateEditModal {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: /Close/i }));

    expect(onClose).toHaveBeenCalled();
  });
});
