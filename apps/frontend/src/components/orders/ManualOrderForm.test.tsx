import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ManualOrderForm from './ManualOrderForm';
import NewOrderPage from '@/app/app/orders/new/page';

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

// Mock useCreateManualOrder and checkOrderNumberDuplicate
let mockMutate = vi.fn();
let mockIsPending = false;
let mockCheckDuplicate = vi.fn().mockResolvedValue(false);

vi.mock('@/hooks/useOrders', () => ({
  useCreateManualOrder: () => ({
    mutate: mockMutate,
    isPending: mockIsPending,
  }),
  checkOrderNumberDuplicate: (...args: unknown[]) => mockCheckDuplicate(...args),
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
    mockCheckDuplicate = vi.fn().mockResolvedValue(false);
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
    // Mock duplicate found via checkOrderNumberDuplicate
    mockCheckDuplicate = vi.fn().mockResolvedValue(true);

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

  it('should show error when delivery window end is before start', async () => {
    const user = userEvent.setup();
    render(<ManualOrderForm />);

    // Fill required fields first
    await user.type(screen.getByLabelText(/Order Number/), 'ORD-WIN');
    await user.type(screen.getByLabelText(/Customer Name/), 'Test User');
    await user.type(screen.getByLabelText(/Customer Phone/), '912345678');
    await user.type(screen.getByLabelText(/Delivery Address/), 'Test Address');

    const comunaInput = screen.getByLabelText(/^Comuna/);
    await user.type(comunaInput, 'Providencia');
    await user.tab();

    const today = new Date().toISOString().slice(0, 10);
    await user.clear(screen.getByLabelText(/Delivery Date/));
    await user.type(screen.getByLabelText(/Delivery Date/), today);

    // Set window end before start
    await user.type(screen.getByLabelText(/Delivery Window Start/), '14:00');
    await user.type(screen.getByLabelText(/Delivery Window End/), '09:00');
    await user.tab();

    await waitFor(() => {
      expect(screen.getByText('Window end must be after window start')).toBeInTheDocument();
    }, { timeout: 3000 });
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

describe('NewOrderPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutate = vi.fn();
    mockIsPending = false;
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

  it('should show loading state initially', () => {
    // Make getSession hang
    mockGetSession.mockReturnValue(new Promise(() => {}));
    render(<NewOrderPage />);
    // Loader2 spinner should be visible (svg with animate-spin)
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeTruthy();
  });

  it('should render form when role is allowed', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { app_metadata: { claims: { role: 'admin' } } } } },
    });

    render(<NewOrderPage />);

    await waitFor(() => {
      expect(screen.getByText('New Order')).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/Order Number/)).toBeInTheDocument();
  });

  it('should show access denied for unauthorized role', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { app_metadata: { claims: { role: 'driver' } } } } },
    });

    render(<NewOrderPage />);

    await waitFor(() => {
      expect(screen.getByText(/don.t have permission/)).toBeInTheDocument();
    });
  });
});
