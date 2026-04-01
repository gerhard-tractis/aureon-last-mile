import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';

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

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

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

const sampleResult = {
  pickup_point_code: '400',
  pickup_point_name: 'Paris Maipú',
  orders: [sampleOrder],
};

// ── OcrTestClient tests ────────────────────────────────────────────────────────
describe('OcrTestClient', () => {
  it('renders header and Abrir cámara button in idle state', () => {
    render(<OcrTestClient />);
    expect(screen.getByText('OCR Test')).toBeInTheDocument();
    expect(screen.getByText('Dev Tool')).toBeInTheDocument();
    expect(screen.getByText('Abrir cámara')).toBeInTheDocument();
    expect(screen.queryByText('Extraer datos')).not.toBeInTheDocument();
  });

  it('shows thumbnail and action buttons after a photo is selected', async () => {
    const { container } = render(<OcrTestClient />);
    await addPhoto(container);
    expect(screen.getByAltText('Foto 1')).toBeInTheDocument();
    expect(screen.getByText('Extraer datos')).toBeInTheDocument();
    expect(screen.getByText('Limpiar')).toBeInTheDocument();
    expect(screen.queryByText('Abrir cámara')).not.toBeInTheDocument();
  });

  it('removes a thumbnail when the delete button is clicked', async () => {
    const { container } = render(<OcrTestClient />);
    await addPhoto(container);
    fireEvent.click(screen.getByLabelText('Eliminar foto 1'));
    expect(screen.queryByAltText('Foto 1')).not.toBeInTheDocument();
    expect(screen.getByText('Abrir cámara')).toBeInTheDocument();
  });

  it('calls fetch with FormData containing the image when Extraer datos is clicked', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => sampleResult });
    const { container } = render(<OcrTestClient />);
    await addPhoto(container);
    fireEvent.click(screen.getByText('Extraer datos'));
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/ocr-test',
      expect.objectContaining({ method: 'POST' }),
    );
    const { body } = mockFetch.mock.calls[0][1] as { body: FormData };
    expect(body.getAll('images')).toHaveLength(1);
  });

  it('shows order cards and summary bar on successful extraction', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => sampleResult });
    const { container } = render(<OcrTestClient />);
    await addPhoto(container);
    fireEvent.click(screen.getByText('Extraer datos'));
    await waitFor(() => expect(screen.getByText(/1 orden encontrada/)).toBeInTheDocument());
    expect(screen.getByText('ORD-001')).toBeInTheDocument();
    expect(screen.getByText('400 · Paris Maipú')).toBeInTheDocument();
  });

  it('shows error box and no order cards on a failed extraction', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'OpenRouter error 429', detail: 'Rate limited' }),
    });
    const { container } = render(<OcrTestClient />);
    await addPhoto(container);
    fireEvent.click(screen.getByText('Extraer datos'));
    await waitFor(() =>
      expect(screen.getByText('OpenRouter error 429')).toBeInTheDocument(),
    );
    expect(screen.queryByText('ORD-001')).not.toBeInTheDocument();
  });

  it('resets to idle when Limpiar is clicked after a result', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => sampleResult });
    const { container } = render(<OcrTestClient />);
    await addPhoto(container);
    fireEvent.click(screen.getByText('Extraer datos'));
    await waitFor(() => screen.getByText('Limpiar'));
    fireEvent.click(screen.getByText('Limpiar'));
    expect(screen.getByText('Abrir cámara')).toBeInTheDocument();
    expect(screen.queryByText('ORD-001')).not.toBeInTheDocument();
  });

  it('toggles the raw JSON block when Ver JSON / Ocultar JSON is clicked', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => sampleResult });
    const { container } = render(<OcrTestClient />);
    await addPhoto(container);
    fireEvent.click(screen.getByText('Extraer datos'));
    await waitFor(() => screen.getByText('Ver JSON'));
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
