import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import type { IntakeStatus } from '@/hooks/pickup/useCameraIntake';

// ── ui mocks ──────────────────────────────────────────────────────────────────
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled }: React.ComponentProps<'button'>) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <div onClick={onClick}>{children}</div>
  ),
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('lucide-react', () => ({
  Camera: () => <span>Camera</span>,
  X: () => <span>X</span>,
  Loader2: () => <span>Loader2</span>,
  ScanText: () => <span>ScanText</span>,
  Trash2: () => <span>Trash2</span>,
  ChevronDown: () => <span>▼</span>,
  ChevronUp: () => <span>▲</span>,
}));

// ── browser API mocks ─────────────────────────────────────────────────────────
Object.defineProperty(URL, 'createObjectURL', {
  writable: true,
  value: vi.fn().mockReturnValue('blob:fake-url'),
});
Object.defineProperty(URL, 'revokeObjectURL', {
  writable: true,
  value: vi.fn(),
});

// Mock Image + Canvas so compressImage resolves instantly
class MockImage {
  width = 800;
  height = 600;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_: string) { setTimeout(() => this.onload?.(), 0); }
}
vi.stubGlobal('Image', MockImage);

HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
  drawImage: vi.fn(),
}) as never;
HTMLCanvasElement.prototype.toBlob = vi.fn().mockImplementation(function (
  this: HTMLCanvasElement,
  cb: (blob: Blob | null) => void,
) {
  cb(new Blob(['compressed'], { type: 'image/jpeg' }));
}) as never;

// ── useCameraIntake mock ───────────────────────────────────────────────────────
const mockSubmit = vi.fn();
const mockReset = vi.fn();

interface MockIntakeState {
  status: IntakeStatus;
  result: { ordersCreated: number; parsedData: Record<string, unknown> | null } | null;
  error: string | null;
  uploadProgress: { current: number; total: number } | null;
  submit: typeof mockSubmit;
  reset: typeof mockReset;
}

let mockIntakeState: MockIntakeState = {
  status: 'idle',
  result: null,
  error: null,
  uploadProgress: null,
  submit: mockSubmit,
  reset: mockReset,
};

vi.mock('@/hooks/pickup/useCameraIntake', () => ({
  useCameraIntake: () => mockIntakeState,
}));

// ── helpers ───────────────────────────────────────────────────────────────────
import OcrTestClient, { OrderCard } from './OcrTestClient';

function fakeFile(name = 'manifest.jpg'): File {
  return new File(['fake'], name, { type: 'image/jpeg' });
}

async function addPhoto(container: HTMLElement, file = fakeFile()) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
  // Wait for async compressImage to settle
  await waitFor(() => expect(screen.getByAltText('Foto 1')).toBeInTheDocument());
}

const sampleOrder = {
  order_number: 'ORD-001',
  customer_name: 'Empresa Test',
  customer_phone: '+56 9 1234 5678',
  delivery_address: 'Av. Libertador 123',
  comuna: 'Santiago',
  delivery_date: '2026-03-30',
  packages: [
    { label: 'PKG-1', package_number: null, declared_box_count: 2, declared_weight_kg: null },
  ],
};

const sampleParsedData = {
  pickup_point_code: '400',
  pickup_point_name: 'Paris Maipú',
  orders: [sampleOrder],
};

const samplePickupPoints = [
  { id: 'pp-1', name: 'Paris Maipú', code: '400' },
  { id: 'pp-2', name: 'Falabella Centro', code: '200' },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockIntakeState = {
    status: 'idle',
    result: null,
    error: null,
    uploadProgress: null,
    submit: mockSubmit,
    reset: mockReset,
  };
});

// ── OcrTestClient tests ────────────────────────────────────────────────────────
describe('OcrTestClient', () => {
  it('renders header and Abrir cámara button in idle state', () => {
    render(<OcrTestClient />);
    expect(screen.getByText('OCR Test')).toBeInTheDocument();
    expect(screen.getByText('Dev Tool')).toBeInTheDocument();
    expect(screen.getByText('Abrir cámara')).toBeInTheDocument();
    expect(screen.queryByText('Extraer datos')).not.toBeInTheDocument();
  });

  it('renders pickup point dropdown with options', () => {
    render(<OcrTestClient pickupPoints={samplePickupPoints} />);
    expect(screen.getByText('Seleccionar punto de retiro…')).toBeInTheDocument();
    expect(screen.getByText('400 — Paris Maipú')).toBeInTheDocument();
    expect(screen.getByText('200 — Falabella Centro')).toBeInTheDocument();
  });

  it('shows thumbnail and action buttons after a photo is selected', async () => {
    const { container } = render(<OcrTestClient pickupPoints={samplePickupPoints} />);
    await addPhoto(container);
    expect(screen.getByAltText('Foto 1')).toBeInTheDocument();
    expect(screen.getByText('Extraer datos')).toBeInTheDocument();
    expect(screen.getByText('Limpiar')).toBeInTheDocument();
    expect(screen.queryByText('Abrir cámara')).not.toBeInTheDocument();
  });

  it('removes a thumbnail when the delete button is clicked', async () => {
    const { container } = render(<OcrTestClient pickupPoints={samplePickupPoints} />);
    await addPhoto(container);
    fireEvent.click(screen.getByLabelText('Eliminar foto 1'));
    expect(screen.queryByAltText('Foto 1')).not.toBeInTheDocument();
    expect(screen.getByText('Abrir cámara')).toBeInTheDocument();
  });

  it('"Extraer datos" is disabled when no pickup point is selected', async () => {
    const { container } = render(<OcrTestClient pickupPoints={samplePickupPoints} />);
    await addPhoto(container);
    const btn = screen.getByText('Extraer datos').closest('button');
    expect(btn).toBeDisabled();
  });

  it('"Extraer datos" is enabled when a pickup point is selected', async () => {
    const { container } = render(<OcrTestClient pickupPoints={samplePickupPoints} />);
    await addPhoto(container);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pp-1' } });
    const btn = screen.getByText('Extraer datos').closest('button');
    expect(btn).not.toBeDisabled();
  });

  it('calls intake.submit with photos and selected pickup point ID', async () => {
    mockSubmit.mockResolvedValue(undefined);
    const { container } = render(<OcrTestClient pickupPoints={samplePickupPoints} />);
    await addPhoto(container);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pp-1' } });
    fireEvent.click(screen.getByText('Extraer datos'));
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledOnce());
    expect(mockSubmit).toHaveBeenCalledWith(
      expect.arrayContaining([expect.any(File)]),
      'pp-1',
    );
  });

  it('shows upload progress during uploading status', async () => {
    mockIntakeState = {
      ...mockIntakeState,
      status: 'uploading',
      uploadProgress: { current: 2, total: 5 },
    };
    const { container } = render(<OcrTestClient pickupPoints={samplePickupPoints} />);
    await addPhoto(container);
    expect(screen.getByText(/Subiendo 2\/5/)).toBeInTheDocument();
  });

  it('shows "Procesando manifiesto…" during processing status', async () => {
    mockIntakeState = { ...mockIntakeState, status: 'processing' };
    const { container } = render(<OcrTestClient pickupPoints={samplePickupPoints} />);
    await addPhoto(container);
    expect(screen.getByText('Procesando manifiesto…')).toBeInTheDocument();
  });

  it('shows order cards from parsedData on success', async () => {
    mockIntakeState = {
      ...mockIntakeState,
      status: 'success',
      result: { ordersCreated: 1, parsedData: sampleParsedData as Record<string, unknown> },
    };
    render(<OcrTestClient pickupPoints={samplePickupPoints} />);
    expect(screen.getByText(/1 orden encontrada/)).toBeInTheDocument();
    expect(screen.getByText('ORD-001')).toBeInTheDocument();
    expect(screen.getByText('400 · Paris Maipú')).toBeInTheDocument();
  });

  it('shows error from intake.error on error status', async () => {
    mockIntakeState = {
      ...mockIntakeState,
      status: 'error',
      error: 'El manifiesto no pudo ser procesado',
    };
    render(<OcrTestClient pickupPoints={samplePickupPoints} />);
    expect(screen.getByText('El manifiesto no pudo ser procesado')).toBeInTheDocument();
  });

  it('calls intake.reset() when Limpiar is clicked', async () => {
    const { container } = render(<OcrTestClient pickupPoints={samplePickupPoints} />);
    await addPhoto(container);
    fireEvent.click(screen.getByText('Limpiar'));
    expect(mockReset).toHaveBeenCalledOnce();
    expect(screen.getByText('Abrir cámara')).toBeInTheDocument();
  });

  it('toggles the raw JSON block when Ver JSON / Ocultar JSON is clicked', () => {
    mockIntakeState = {
      ...mockIntakeState,
      status: 'success',
      result: { ordersCreated: 1, parsedData: sampleParsedData as Record<string, unknown> },
    };
    render(<OcrTestClient pickupPoints={samplePickupPoints} />);
    expect(screen.queryByText(/"orders"/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Ver JSON'));
    expect(screen.getByText(/"orders"/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Ocultar JSON'));
    expect(screen.queryByText(/"orders"/)).not.toBeInTheDocument();
  });
});

// ── OrderCard tests ────────────────────────────────────────────────────────────
describe('OrderCard', () => {
  it('is expanded by default for the first card (index 0)', () => {
    render(<OrderCard order={sampleOrder} index={0} />);
    expect(screen.getByText('Av. Libertador 123')).toBeInTheDocument();
    expect(screen.getByText('+56 9 1234 5678')).toBeInTheDocument();
  });

  it('is collapsed by default for subsequent cards (index > 0)', () => {
    render(<OrderCard order={sampleOrder} index={1} />);
    expect(screen.queryByText('Av. Libertador 123')).not.toBeInTheDocument();
  });

  it('expands and collapses when the header is clicked', () => {
    render(<OrderCard order={sampleOrder} index={1} />);
    expect(screen.queryByText('Av. Libertador 123')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('ORD-001'));
    expect(screen.getByText('Av. Libertador 123')).toBeInTheDocument();
    fireEvent.click(screen.getByText('ORD-001'));
    expect(screen.queryByText('Av. Libertador 123')).not.toBeInTheDocument();
  });
});
