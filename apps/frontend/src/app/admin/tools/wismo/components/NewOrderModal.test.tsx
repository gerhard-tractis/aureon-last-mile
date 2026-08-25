import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { NewOrderModal } from './NewOrderModal';

describe('NewOrderModal', () => {
  it('renders all required fields', () => {
    render(<NewOrderModal onClose={vi.fn()} onCreate={vi.fn()} />);
    expect(screen.getByPlaceholderText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('+1 555 000 0000')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create Order/i })).toBeInTheDocument();
  });

  it('renders optional window start and end fields', () => {
    render(<NewOrderModal onClose={vi.fn()} onCreate={vi.fn()} />);
    expect(screen.getByText(/Window Start/i)).toBeInTheDocument();
    expect(screen.getByText(/Window End/i)).toBeInTheDocument();
  });

  it('calls onCreate with correct data on submit', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<NewOrderModal onClose={onClose} onCreate={onCreate} />);

    await user.type(screen.getByPlaceholderText('Jane Doe'), 'Alice Smith');
    await user.type(screen.getByPlaceholderText('+1 555 000 0000'), '+1 555 999 0000');

    // Fill the date field
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    await user.type(dateInput, '2026-04-30');

    await user.click(screen.getByRole('button', { name: /Create Order/i }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          customer_name: 'Alice Smith',
          customer_phone: '+1 555 999 0000',
        }),
      );
    });
  });

  it('shows error when onCreate throws', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockRejectedValue(new Error('Server error'));
    render(<NewOrderModal onClose={vi.fn()} onCreate={onCreate} />);

    // Fill required fields to bypass HTML5 validation
    await user.type(screen.getByPlaceholderText('Jane Doe'), 'Bob');
    await user.type(screen.getByPlaceholderText('+1 555 000 0000'), '555');
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    await user.type(dateInput, '2026-04-30');

    await user.click(screen.getByRole('button', { name: /Create Order/i }));

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });
  });

  it('calls onClose when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<NewOrderModal onClose={onClose} onCreate={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes modal on successful creation', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<NewOrderModal onClose={onClose} onCreate={onCreate} />);

    await user.type(screen.getByPlaceholderText('Jane Doe'), 'Carol');
    await user.type(screen.getByPlaceholderText('+1 555 000 0000'), '555');
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    await user.type(dateInput, '2026-04-30');

    await user.click(screen.getByRole('button', { name: /Create Order/i }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });
});
