import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QRScanner } from './QRScanner';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: mockFrom,
  }),
}));

describe('QRScanner', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockFrom.mockClear();
  });

  it('renders the scanner UI', () => {
    render(<QRScanner onClose={vi.fn()} operatorId="op-123" />);
    expect(screen.getByText('Escanear QR de manifiesto')).toBeInTheDocument();
  });

  it('shows close button', () => {
    const onClose = vi.fn();
    render(<QRScanner onClose={onClose} operatorId="op-123" />);
    const closeBtn = screen.getByRole('button', { name: /cerrar/i });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('validates UUID format and rejects non-UUID values', async () => {
    render(<QRScanner onClose={vi.fn()} operatorId="op-123" />);

    // Simulate scanning a non-UUID value via the manual input
    const input = screen.getByPlaceholderText(/ID del manifiesto/i);
    fireEvent.change(input, { target: { value: 'not-a-uuid' } });
    fireEvent.click(screen.getByRole('button', { name: /buscar/i }));

    await waitFor(() => {
      expect(screen.getByText('Código QR no válido')).toBeInTheDocument();
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('looks up manifest for valid UUID and navigates on success', async () => {
    const mockSelectChain = {
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
    };
    mockFrom.mockReturnValue(mockSelectChain);

    render(<QRScanner onClose={vi.fn()} operatorId="op-123" />);

    const input = screen.getByPlaceholderText(/ID del manifiesto/i);
    fireEvent.change(input, {
      target: { value: '550e8400-e29b-41d4-a716-446655440000' },
    });
    fireEvent.click(screen.getByRole('button', { name: /buscar/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(
        '/app/reception/scan/reception-1'
      );
    });
  });

  it('shows already-received message for received manifest', async () => {
    const mockSelectChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          reception_status: 'received',
          hub_receptions: [{
            id: 'reception-1',
            status: 'completed',
            completed_at: '2026-03-18T12:00:00Z',
            received_by_user: { full_name: 'Juan Perez' },
          }],
        },
        error: null,
      }),
    };
    mockFrom.mockReturnValue(mockSelectChain);

    render(<QRScanner onClose={vi.fn()} operatorId="op-123" />);

    const input = screen.getByPlaceholderText(/ID del manifiesto/i);
    fireEvent.change(input, {
      target: { value: '550e8400-e29b-41d4-a716-446655440000' },
    });
    fireEvent.click(screen.getByRole('button', { name: /buscar/i }));

    await waitFor(() => {
      expect(screen.getByText('Esta carga ya fue recibida')).toBeInTheDocument();
    });
  });

  it('shows error when manifest not found', async () => {
    const mockSelectChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'not found' },
      }),
    };
    mockFrom.mockReturnValue(mockSelectChain);

    render(<QRScanner onClose={vi.fn()} operatorId="op-123" />);

    const input = screen.getByPlaceholderText(/ID del manifiesto/i);
    fireEvent.change(input, {
      target: { value: '550e8400-e29b-41d4-a716-446655440000' },
    });
    fireEvent.click(screen.getByRole('button', { name: /buscar/i }));

    await waitFor(() => {
      expect(screen.getByText(/no encontrado/i)).toBeInTheDocument();
    });
  });
});
