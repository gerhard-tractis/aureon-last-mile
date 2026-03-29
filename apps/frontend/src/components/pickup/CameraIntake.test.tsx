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
let mockUploadProgress: { current: number; total: number } | null = null;

vi.mock('@/hooks/pickup/useCameraIntake', () => ({
  useCameraIntake: () => ({
    submit: mockSubmit,
    reset: mockReset,
    status: mockStatus,
    result: mockResult,
    error: mockError,
    uploadProgress: mockUploadProgress,
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

// ── usePickupPointsByClient mock ─────────────────────────────────────────────
let mockPickupPoints: { id: string; name: string }[] = [];
let mockPickupPointsLoading = false;

vi.mock('@/hooks/pickup/usePickupPointsByClient', () => ({
  usePickupPointsByClient: (_opId: string | null, clientId: string | null) => ({
    data: clientId ? mockPickupPoints : undefined,
    isLoading: clientId ? mockPickupPointsLoading : false,
  }),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-123' }),
}));

// ── helpers ──────────────────────────────────────────────────────────────────
function setFiles(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
}

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
    mockUploadProgress = null;
    mockClients = [
      { id: 'client-1', name: 'Easy' },
      { id: 'client-2', name: 'Paris' },
    ];
    mockClientsLoading = false;
    mockPickupPoints = [
      { id: 'pp-1', name: 'Easy Maipú' },
      { id: 'pp-2', name: 'Easy Puente Alto' },
    ];
    mockPickupPointsLoading = false;
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

  // ── Pickup point dropdown ─────────────────────────────────────────────────
  it('disables pickup-point dropdown until client is selected', () => {
    renderIntake();
    const ppSelect = screen.getByTestId('pickup-point-select');
    expect(ppSelect).toBeDisabled();
  });

  it('shows pickup points after selecting client', () => {
    renderIntake();
    fireEvent.change(screen.getByTestId('client-select'), { target: { value: 'client-1' } });
    const ppSelect = screen.getByTestId('pickup-point-select');
    expect(ppSelect).not.toBeDisabled();
    expect(screen.getByText('Easy Maipú')).toBeInTheDocument();
    expect(screen.getByText('Easy Puente Alto')).toBeInTheDocument();
  });

  it('resets pickup point when client changes', () => {
    renderIntake();
    fireEvent.change(screen.getByTestId('client-select'), { target: { value: 'client-1' } });
    fireEvent.change(screen.getByTestId('pickup-point-select'), { target: { value: 'pp-1' } });
    expect(screen.getByTestId('pickup-point-select')).toHaveValue('pp-1');

    fireEvent.change(screen.getByTestId('client-select'), { target: { value: 'client-2' } });
    expect(screen.getByTestId('pickup-point-select')).toHaveValue('');
  });

  it('shows message when client has zero pickup points', () => {
    mockPickupPoints = [];
    renderIntake();
    fireEvent.change(screen.getByTestId('client-select'), { target: { value: 'client-1' } });
    expect(screen.getByTestId('no-pickup-points')).toBeInTheDocument();
    expect(screen.getByText('No hay puntos de retiro configurados para este cliente')).toBeInTheDocument();
  });

  // ── Camera button (no photos yet) ─────────────────────────────────────────
  it('disables camera button until pickup point is selected', () => {
    renderIntake();
    const cameraBtn = screen.getByText('Tomar foto');
    expect(cameraBtn).toBeDisabled();

    fireEvent.change(screen.getByTestId('client-select'), { target: { value: 'client-1' } });
    expect(cameraBtn).toBeDisabled();

    fireEvent.change(screen.getByTestId('pickup-point-select'), { target: { value: 'pp-1' } });
    expect(cameraBtn).not.toBeDisabled();
  });

  it('renders file input with camera capture attribute', () => {
    renderIntake();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    expect(fileInput.getAttribute('capture')).toBe('environment');
    expect(fileInput.getAttribute('accept')).toContain('image/*');
  });

  // ── Multi-photo flow ──────────────────────────────────────────────────────
  it('shows thumbnail strip after first photo is taken', () => {
    renderIntake();
    fireEvent.change(screen.getByTestId('client-select'), { target: { value: 'client-1' } });
    fireEvent.change(screen.getByTestId('pickup-point-select'), { target: { value: 'pp-1' } });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' });
    setFiles(fileInput, [file]);
    fireEvent.change(fileInput);

    expect(screen.getByTestId('photo-thumb-0')).toBeInTheDocument();
    expect(screen.getByText('Tomar otra pagina')).toBeInTheDocument();
    expect(screen.getByText('Enviar (1)')).toBeInTheDocument();
  });

  it('can add multiple photos and shows correct count', () => {
    renderIntake();
    fireEvent.change(screen.getByTestId('client-select'), { target: { value: 'client-1' } });
    fireEvent.change(screen.getByTestId('pickup-point-select'), { target: { value: 'pp-1' } });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    const file1 = new File(['img1'], 'photo1.jpg', { type: 'image/jpeg' });
    setFiles(fileInput, [file1]);
    fireEvent.change(fileInput);

    const file2 = new File(['img2'], 'photo2.jpg', { type: 'image/jpeg' });
    setFiles(fileInput, [file2]);
    fireEvent.change(fileInput);

    expect(screen.getByTestId('photo-thumb-0')).toBeInTheDocument();
    expect(screen.getByTestId('photo-thumb-1')).toBeInTheDocument();
    expect(screen.getByText('Enviar (2)')).toBeInTheDocument();
  });

  it('can remove a photo from the strip', () => {
    renderIntake();
    fireEvent.change(screen.getByTestId('client-select'), { target: { value: 'client-1' } });
    fireEvent.change(screen.getByTestId('pickup-point-select'), { target: { value: 'pp-1' } });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file1 = new File(['img1'], 'photo1.jpg', { type: 'image/jpeg' });
    setFiles(fileInput, [file1]);
    fireEvent.change(fileInput);

    const file2 = new File(['img2'], 'photo2.jpg', { type: 'image/jpeg' });
    setFiles(fileInput, [file2]);
    fireEvent.change(fileInput);

    expect(screen.getByText('Enviar (2)')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('remove-photo-0'));

    expect(screen.queryByTestId('photo-thumb-1')).not.toBeInTheDocument();
    expect(screen.getByText('Enviar (1)')).toBeInTheDocument();
  });

  it('disables "Tomar otra pagina" at 10 photos', () => {
    renderIntake();
    fireEvent.change(screen.getByTestId('client-select'), { target: { value: 'client-1' } });
    fireEvent.change(screen.getByTestId('pickup-point-select'), { target: { value: 'pp-1' } });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    for (let i = 0; i < 10; i++) {
      const file = new File([`img${i}`], `photo${i}.jpg`, { type: 'image/jpeg' });
      setFiles(fileInput, [file]);
      fireEvent.change(fileInput);
    }

    expect(screen.getByText('Tomar otra pagina')).toBeDisabled();
    expect(screen.getByText('Enviar (10)')).toBeInTheDocument();
  });

  it('calls submit with all photos and selectedPickupPointId', () => {
    renderIntake();
    fireEvent.change(screen.getByTestId('client-select'), { target: { value: 'client-1' } });
    fireEvent.change(screen.getByTestId('pickup-point-select'), { target: { value: 'pp-1' } });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file1 = new File(['img1'], 'photo1.jpg', { type: 'image/jpeg' });
    setFiles(fileInput, [file1]);
    fireEvent.change(fileInput);

    const file2 = new File(['img2'], 'photo2.jpg', { type: 'image/jpeg' });
    setFiles(fileInput, [file2]);
    fireEvent.change(fileInput);

    fireEvent.click(screen.getByTestId('submit-btn'));

    expect(mockSubmit).toHaveBeenCalledWith([file1, file2], 'pp-1');
  });

  // ── Upload progress ───────────────────────────────────────────────────────
  it('shows upload progress during uploading state', () => {
    mockStatus = 'uploading';
    mockUploadProgress = { current: 2, total: 5 };
    renderIntake();
    expect(screen.getByText('Subiendo foto 2 de 5...')).toBeInTheDocument();
  });

  it('shows generic processing text when uploading with no progress yet', () => {
    mockStatus = 'uploading';
    mockUploadProgress = null;
    renderIntake();
    expect(screen.getByText('Procesando manifiesto...')).toBeInTheDocument();
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
