import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ManualOrderForm from './ManualOrderForm';

// Mock session data
const mockSession = {
  user: {
    id: 'user-uuid-123',
    app_metadata: {
      claims: {
        role: 'admin',
        operator_id: 'op-uuid-123',
      },
    },
  },
};

// Mock Supabase client
const mockFrom = vi.fn();
const mockGetSession = vi.fn().mockResolvedValue({ data: { session: mockSession } });

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    auth: { getSession: mockGetSession },
    from: mockFrom,
  }),
}));

// Mock toast
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

// Mock useCreateManualOrder
let mockMutate = vi.fn();
let mockIsPending = false;

vi.mock('@/hooks/useOrders', () => ({
  useCreateManualOrder: () => ({
    mutate: mockMutate,
    isPending: mockIsPending,
  }),
}));

// Mock QueryClient for TanStack Query
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: vi.fn(),
}));

describe('ManualOrderForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutate = vi.fn();
    mockIsPending = false;
    // Default: no duplicate found
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          }),
        }),
      }),
    });
  });

  it('should render all required fields', () => {
    render(<ManualOrderForm />);

    expect(screen.getByLabelText(/Order Number/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Customer Name/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Customer Phone/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Delivery Address/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Comuna/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Delivery Date/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Delivery Window Start/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Delivery Window End/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Retailer Name/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Notes/)).toBeInTheDocument();
    expect(screen.getByText('Save Order')).toBeInTheDocument();
  });

  it('should have submit button disabled when required fields are empty', () => {
    render(<ManualOrderForm />);

    const submitButton = screen.getByText('Save Order');
    expect(submitButton).toBeDisabled();
  });

  it('should show phone validation error for invalid format', async () => {
    const user = userEvent.setup();
    render(<ManualOrderForm />);

    const phoneInput = screen.getByLabelText(/Customer Phone/);
    await user.type(phoneInput, '12345');
    await user.tab(); // blur

    await waitFor(() => {
      expect(screen.getByText('Phone must be 9 digits')).toBeInTheDocument();
    });
  });

  it('should not show phone error for valid format', async () => {
    const user = userEvent.setup();
    render(<ManualOrderForm />);

    const phoneInput = screen.getByLabelText(/Customer Phone/);
    await user.type(phoneInput, '912345678');
    await user.tab();

    await waitFor(() => {
      expect(screen.queryByText('Phone must be 9 digits')).not.toBeInTheDocument();
    });
  });

  it('should show duplicate order number error', async () => {
    // Mock duplicate found
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'existing-id' } }),
          }),
        }),
      }),
    });

    const user = userEvent.setup();
    render(<ManualOrderForm />);

    const orderInput = screen.getByLabelText(/Order Number/);
    await user.type(orderInput, 'ORD-001');

    await waitFor(
      () => {
        expect(screen.getByText(/already exists for this operator/)).toBeInTheDocument();
      },
      { timeout: 2000 }
    );
  });

  it('should show warning for delivery date >30 days away', async () => {
    const user = userEvent.setup();
    render(<ManualOrderForm />);

    const dateInput = screen.getByLabelText(/Delivery Date/);
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 45);
    const futureDateStr = futureDate.toISOString().slice(0, 10);

    await user.clear(dateInput);
    await user.type(dateInput, futureDateStr);
    await user.tab();

    await waitFor(() => {
      expect(screen.getByText(/more than 30 days away/)).toBeInTheDocument();
    });
  });

  it('should call mutation and show success toast on valid submit', async () => {
    mockMutate = vi.fn((_, { onSuccess }) => {
      onSuccess();
    });

    const user = userEvent.setup();
    render(<ManualOrderForm />);

    // Fill all required fields
    await user.type(screen.getByLabelText(/Order Number/), 'ORD-TEST');
    await user.type(screen.getByLabelText(/Customer Name/), 'Juan Pérez');
    await user.type(screen.getByLabelText(/Customer Phone/), '912345678');
    await user.type(screen.getByLabelText(/Delivery Address/), 'Av. Providencia 1234');

    const comunaInput = screen.getByLabelText(/^Comuna/);
    await user.type(comunaInput, 'Providencia');
    await user.tab();

    const today = new Date().toISOString().slice(0, 10);
    const dateInput = screen.getByLabelText(/Delivery Date/);
    await user.clear(dateInput);
    await user.type(dateInput, today);
    await user.tab();

    // Wait for form to become valid
    await waitFor(() => {
      expect(screen.getByText('Save Order')).not.toBeDisabled();
    }, { timeout: 3000 });

    await user.click(screen.getByText('Save Order'));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith(expect.stringContaining('ORD-TEST'));
    });
  });

  it('should show Add Another Order button after successful submit', async () => {
    mockMutate = vi.fn((_, { onSuccess }) => {
      onSuccess();
    });

    const user = userEvent.setup();
    render(<ManualOrderForm />);

    await user.type(screen.getByLabelText(/Order Number/), 'ORD-TEST');
    await user.type(screen.getByLabelText(/Customer Name/), 'Juan Pérez');
    await user.type(screen.getByLabelText(/Customer Phone/), '912345678');
    await user.type(screen.getByLabelText(/Delivery Address/), 'Av. Providencia 1234');

    const comunaInput = screen.getByLabelText(/^Comuna/);
    await user.type(comunaInput, 'Providencia');
    await user.tab();

    const today = new Date().toISOString().slice(0, 10);
    await user.clear(screen.getByLabelText(/Delivery Date/));
    await user.type(screen.getByLabelText(/Delivery Date/), today);
    await user.tab();

    await waitFor(() => {
      expect(screen.getByText('Save Order')).not.toBeDisabled();
    }, { timeout: 3000 });

    await user.click(screen.getByText('Save Order'));

    await waitFor(() => {
      expect(screen.getByText('Add Another Order')).toBeInTheDocument();
    });
  });

  it('should reset form when Add Another Order is clicked', async () => {
    mockMutate = vi.fn((_, { onSuccess }) => {
      onSuccess();
    });

    const user = userEvent.setup();
    render(<ManualOrderForm />);

    await user.type(screen.getByLabelText(/Order Number/), 'ORD-TEST');
    await user.type(screen.getByLabelText(/Customer Name/), 'Juan Pérez');
    await user.type(screen.getByLabelText(/Customer Phone/), '912345678');
    await user.type(screen.getByLabelText(/Delivery Address/), 'Av. Providencia 1234');

    const comunaInput = screen.getByLabelText(/^Comuna/);
    await user.type(comunaInput, 'Providencia');
    await user.tab();

    const today = new Date().toISOString().slice(0, 10);
    await user.clear(screen.getByLabelText(/Delivery Date/));
    await user.type(screen.getByLabelText(/Delivery Date/), today);
    await user.tab();

    await waitFor(() => {
      expect(screen.getByText('Save Order')).not.toBeDisabled();
    }, { timeout: 3000 });

    await user.click(screen.getByText('Save Order'));

    await waitFor(() => {
      expect(screen.getByText('Add Another Order')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Add Another Order'));

    await waitFor(() => {
      expect((screen.getByLabelText(/Order Number/) as HTMLInputElement).value).toBe('');
    });
  });

  it('should show error toast and preserve form on submit error', async () => {
    mockMutate = vi.fn((_, { onError }) => {
      onError(new Error('Network error'));
    });

    const user = userEvent.setup();
    render(<ManualOrderForm />);

    await user.type(screen.getByLabelText(/Order Number/), 'ORD-ERR');
    await user.type(screen.getByLabelText(/Customer Name/), 'Test User');
    await user.type(screen.getByLabelText(/Customer Phone/), '912345678');
    await user.type(screen.getByLabelText(/Delivery Address/), 'Test Address');

    const comunaInput = screen.getByLabelText(/^Comuna/);
    await user.type(comunaInput, 'Providencia');
    await user.tab();

    const today = new Date().toISOString().slice(0, 10);
    await user.clear(screen.getByLabelText(/Delivery Date/));
    await user.type(screen.getByLabelText(/Delivery Date/), today);
    await user.tab();

    await waitFor(() => {
      expect(screen.getByText('Save Order')).not.toBeDisabled();
    }, { timeout: 3000 });

    await user.click(screen.getByText('Save Order'));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Failed to save order. Please try again.');
    });

    // Form values preserved
    expect((screen.getByLabelText(/Order Number/) as HTMLInputElement).value).toBe('ORD-ERR');
  });
});
