import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QRScanner } from './QRScanner';

vi.mock('html5-qrcode', () => ({
  Html5Qrcode: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn(),
  })),
}));

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ from: mockFrom }),
}));

describe('QRScanner', () => {
  beforeEach(() => { mockPush.mockClear(); mockFrom.mockClear(); });

  it('renders scanner container', () => {
    const { container } = render(<QRScanner onClose={vi.fn()} operatorId="op-123" />);
    expect(container.querySelector('#qr-reader')).toBeInTheDocument();
  });

  it('renders manual input fallback', () => {
    render(<QRScanner onClose={vi.fn()} operatorId="op-123" />);
    expect(screen.getByPlaceholderText(/ID del manifiesto/i)).toBeInTheDocument();
  });

  it('validates UUID format', async () => {
    render(<QRScanner onClose={vi.fn()} operatorId="op-123" />);
    const input = screen.getByPlaceholderText(/ID del manifiesto/i);
    fireEvent.change(input, { target: { value: 'not-a-uuid' } });
    fireEvent.click(screen.getByRole('button', { name: /buscar/i }));
    await waitFor(() => {
      expect(screen.getByText('Código QR no válido')).toBeInTheDocument();
    });
  });

  it('navigates on valid UUID lookup', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          reception_status: 'awaiting_reception',
          hub_receptions: [{ id: 'reception-1', status: 'pending' }],
        },
        error: null,
      }),
    });

    render(<QRScanner onClose={vi.fn()} operatorId="op-123" />);
    const input = screen.getByPlaceholderText(/ID del manifiesto/i);
    fireEvent.change(input, { target: { value: '550e8400-e29b-41d4-a716-446655440000' } });
    fireEvent.click(screen.getByRole('button', { name: /buscar/i }));
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/app/reception/scan/reception-1');
    });
  });

  it('shows already-received message', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          reception_status: 'received',
          hub_receptions: [{ id: 'reception-1', status: 'completed',
            completed_at: '2026-03-18T12:00:00Z',
            received_by_user: { full_name: 'Juan Perez' } }],
        },
        error: null,
      }),
    });

    render(<QRScanner onClose={vi.fn()} operatorId="op-123" />);
    const input = screen.getByPlaceholderText(/ID del manifiesto/i);
    fireEvent.change(input, { target: { value: '550e8400-e29b-41d4-a716-446655440000' } });
    fireEvent.click(screen.getByRole('button', { name: /buscar/i }));
    await waitFor(() => {
      expect(screen.getByText('Esta carga ya fue recibida')).toBeInTheDocument();
    });
  });

  it('shows error when manifest not found', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
    });

    render(<QRScanner onClose={vi.fn()} operatorId="op-123" />);
    const input = screen.getByPlaceholderText(/ID del manifiesto/i);
    fireEvent.change(input, { target: { value: '550e8400-e29b-41d4-a716-446655440000' } });
    fireEvent.click(screen.getByRole('button', { name: /buscar/i }));
    await waitFor(() => {
      expect(screen.getByText(/no encontrado/i)).toBeInTheDocument();
    });
  });
});
