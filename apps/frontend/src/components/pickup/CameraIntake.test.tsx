import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CameraIntake } from './CameraIntake';

// ── useCameraIntake mock ─────────────────────────────────────────────────────
const mockSubmit = vi.fn();
const mockReset = vi.fn();
let mockStatus = 'idle';
let mockResult: { ordersCreated: number } | null = null;
let mockError: string | null = null;

vi.mock('@/hooks/pickup/useCameraIntake', () => ({
  useCameraIntake: () => ({
    submit: mockSubmit,
    reset: mockReset,
    status: mockStatus,
    result: mockResult,
    error: mockError,
  }),
}));

// ── Supabase mock (generators query) ────────────────────────────────────────
const mockGenerators = [
  { id: 'gen-1', name: 'Easy Maipú' },
  { id: 'gen-2', name: 'Paris Las Condes' },
];

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            is: () =>
              Promise.resolve({ data: mockGenerators, error: null }),
          }),
        }),
      }),
    }),
  }),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-123' }),
}));

// ── helpers ──────────────────────────────────────────────────────────────────
function renderIntake(onClose = vi.fn()) {
  return render(<CameraIntake onClose={onClose} />);
}

describe('CameraIntake', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStatus = 'idle';
    mockResult = null;
    mockError = null;
  });

  it('renders generator selector after load', async () => {
    renderIntake();
    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });
    expect(screen.getByText('Easy Maipú')).toBeInTheDocument();
    expect(screen.getByText('Paris Las Condes')).toBeInTheDocument();
  });

  it('renders file input with camera capture attribute', async () => {
    renderIntake();
    await waitFor(() => screen.getByRole('combobox'));
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    expect(fileInput.getAttribute('capture')).toBe('environment');
    expect(fileInput.getAttribute('accept')).toContain('image/*');
  });

  it('calls submit with file and selected generator', async () => {
    renderIntake();
    await waitFor(() => screen.getByRole('combobox'));

    // Select generator
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'gen-1' } });

    // Simulate file selection
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' });
    Object.defineProperty(fileInput, 'files', { value: [file] });
    fireEvent.change(fileInput);

    expect(mockSubmit).toHaveBeenCalledWith(file, 'gen-1');
  });

  it('shows processing state', async () => {
    mockStatus = 'processing';
    renderIntake();
    await waitFor(() => {
      expect(screen.getByText('Procesando manifiesto...')).toBeInTheDocument();
    });
  });

  it('shows success state with order count', async () => {
    mockStatus = 'success';
    mockResult = { ordersCreated: 12 };
    renderIntake();
    await waitFor(() => {
      expect(screen.getByText(/12/)).toBeInTheDocument();
      expect(screen.getByText('Cerrar')).toBeInTheDocument();
    });
  });

  it('shows error state with retry button', async () => {
    mockStatus = 'error';
    mockError = 'Fallo de conexión';
    renderIntake();
    await waitFor(() => {
      expect(screen.getByText('Fallo de conexión')).toBeInTheDocument();
      expect(screen.getByText('Reintentar')).toBeInTheDocument();
    });
  });

  it('calls reset when retry is clicked', async () => {
    mockStatus = 'error';
    mockError = 'Fallo de conexión';
    renderIntake();
    await waitFor(() => screen.getByText('Reintentar'));
    fireEvent.click(screen.getByText('Reintentar'));
    expect(mockReset).toHaveBeenCalled();
  });

  it('calls onClose when Cerrar clicked in success state', async () => {
    mockStatus = 'success';
    mockResult = { ordersCreated: 3 };
    const onClose = vi.fn();
    renderIntake(onClose);
    await waitFor(() => screen.getByText('Cerrar'));
    fireEvent.click(screen.getByText('Cerrar'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when Cancelar clicked in idle state', async () => {
    const onClose = vi.fn();
    renderIntake(onClose);
    await waitFor(() => screen.getByRole('combobox'));
    fireEvent.click(screen.getByText('Cancelar'));
    expect(onClose).toHaveBeenCalled();
  });
});
