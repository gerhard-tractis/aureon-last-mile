import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
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

// ── useTenantClients mock ────────────────────────────────────────────────────
let mockClients: { id: string; name: string }[] = [
  { id: 'client-1', name: 'Easy' },
  { id: 'client-2', name: 'Paris' },
];
let mockClientsLoading = false;

vi.mock('@/hooks/useTenantClients', () => ({
  useTenantClients: () => ({
    data: mockClients,
    isLoading: mockClientsLoading,
  }),
}));

// ── useGeneratorsByClient mock ───────────────────────────────────────────────
let mockGenerators: { id: string; name: string }[] = [];
let mockGeneratorsLoading = false;

vi.mock('@/hooks/pickup/useGeneratorsByClient', () => ({
  useGeneratorsByClient: (_opId: string | null, clientId: string | null) => ({
    data: clientId ? mockGenerators : undefined,
    isLoading: clientId ? mockGeneratorsLoading : false,
  }),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-123' }),
}));

// ── helpers ──────────────────────────────────────────────────────────────────
function renderIntake(onClose = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(CameraIntake, { onClose })
    )
  );
}

describe('CameraIntake', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStatus = 'idle';
    mockResult = null;
    mockError = null;
    mockClients = [
      { id: 'client-1', name: 'Easy' },
      { id: 'client-2', name: 'Paris' },
    ];
    mockClientsLoading = false;
    mockGenerators = [
      { id: 'gen-1', name: 'Easy Maipú' },
      { id: 'gen-2', name: 'Easy Puente Alto' },
    ];
    mockGeneratorsLoading = false;
  });

  // ── Client dropdown ───────────────────────────────────────────────────────
  it('renders client dropdown with clients', () => {
    renderIntake();
    const select = screen.getByTestId('client-select');
    expect(select).toBeInTheDocument();
    expect(screen.getByText('Easy')).toBeInTheDocument();
    expect(screen.getByText('Paris')).toBeInTheDocument();
  });

  it('shows loading state while fetching clients', () => {
    mockClientsLoading = true;
    renderIntake();
    expect(screen.getByText('Cargando clientes...')).toBeInTheDocument();
  });

  it('shows empty state when no clients configured', () => {
    mockClients = [];
    const onClose = vi.fn();
    renderIntake(onClose);
    expect(screen.getByText('Sin clientes configurados')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cerrar'));
    expect(onClose).toHaveBeenCalled();
  });

  // ── Generator dropdown ────────────────────────────────────────────────────
  it('disables generator dropdown until client is selected', () => {
    renderIntake();
    const genSelect = screen.getByTestId('generator-select');
    expect(genSelect).toBeDisabled();
  });

  it('shows generators after selecting client', () => {
    renderIntake();
    fireEvent.change(screen.getByTestId('client-select'), { target: { value: 'client-1' } });
    const genSelect = screen.getByTestId('generator-select');
    expect(genSelect).not.toBeDisabled();
    expect(screen.getByText('Easy Maipú')).toBeInTheDocument();
    expect(screen.getByText('Easy Puente Alto')).toBeInTheDocument();
  });

  it('resets generator when client changes', () => {
    renderIntake();
    // Select client and generator
    fireEvent.change(screen.getByTestId('client-select'), { target: { value: 'client-1' } });
    fireEvent.change(screen.getByTestId('generator-select'), { target: { value: 'gen-1' } });
    expect(screen.getByTestId('generator-select')).toHaveValue('gen-1');

    // Change client → generator resets
    fireEvent.change(screen.getByTestId('client-select'), { target: { value: 'client-2' } });
    expect(screen.getByTestId('generator-select')).toHaveValue('');
  });

  it('shows message when client has zero generators', () => {
    mockGenerators = [];
    renderIntake();
    fireEvent.change(screen.getByTestId('client-select'), { target: { value: 'client-1' } });
    expect(screen.getByTestId('no-pickup-points')).toBeInTheDocument();
    expect(screen.getByText('No hay puntos de retiro configurados para este cliente')).toBeInTheDocument();
  });

  // ── Camera button ─────────────────────────────────────────────────────────
  it('disables camera button until generator is selected', () => {
    renderIntake();
    const cameraBtn = screen.getByText('Tomar foto');
    expect(cameraBtn).toBeDisabled();

    fireEvent.change(screen.getByTestId('client-select'), { target: { value: 'client-1' } });
    expect(cameraBtn).toBeDisabled();

    fireEvent.change(screen.getByTestId('generator-select'), { target: { value: 'gen-1' } });
    expect(cameraBtn).not.toBeDisabled();
  });

  it('renders file input with camera capture attribute', () => {
    renderIntake();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    expect(fileInput.getAttribute('capture')).toBe('environment');
    expect(fileInput.getAttribute('accept')).toContain('image/*');
  });

  it('calls submit with file and selected generator', () => {
    renderIntake();
    fireEvent.change(screen.getByTestId('client-select'), { target: { value: 'client-1' } });
    fireEvent.change(screen.getByTestId('generator-select'), { target: { value: 'gen-1' } });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' });
    Object.defineProperty(fileInput, 'files', { value: [file] });
    fireEvent.change(fileInput);

    expect(mockSubmit).toHaveBeenCalledWith(file, 'gen-1');
  });

  // ── Status states ─────────────────────────────────────────────────────────
  it('shows processing state', () => {
    mockStatus = 'processing';
    renderIntake();
    expect(screen.getByText('Procesando manifiesto...')).toBeInTheDocument();
  });

  it('shows success state with order count', () => {
    mockStatus = 'success';
    mockResult = { ordersCreated: 12 };
    renderIntake();
    expect(screen.getByText(/12/)).toBeInTheDocument();
    expect(screen.getByText('Cerrar')).toBeInTheDocument();
  });

  it('shows error state with retry button', () => {
    mockStatus = 'error';
    mockError = 'Fallo de conexión';
    renderIntake();
    expect(screen.getByText('Fallo de conexión')).toBeInTheDocument();
    expect(screen.getByText('Reintentar')).toBeInTheDocument();
  });

  it('calls reset when retry is clicked', () => {
    mockStatus = 'error';
    mockError = 'Fallo de conexión';
    renderIntake();
    fireEvent.click(screen.getByText('Reintentar'));
    expect(mockReset).toHaveBeenCalled();
  });

  it('calls onClose when Cerrar clicked in success state', () => {
    mockStatus = 'success';
    mockResult = { ordersCreated: 3 };
    const onClose = vi.fn();
    renderIntake(onClose);
    fireEvent.click(screen.getByText('Cerrar'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when Cancelar clicked in idle state', () => {
    const onClose = vi.fn();
    renderIntake(onClose);
    fireEvent.click(screen.getByText('Cancelar'));
    expect(onClose).toHaveBeenCalled();
  });
});
