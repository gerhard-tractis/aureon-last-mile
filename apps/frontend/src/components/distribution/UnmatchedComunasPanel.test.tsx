import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UnmatchedComunasPanel } from './UnmatchedComunasPanel';
import { useUnmatchedComunas as _useUnmatchedComunas } from '@/hooks/distribution/useUnmatchedComunas';

const mockMapMutate = vi.fn();

vi.mock('@/hooks/distribution/useUnmatchedComunas', () => ({
  useUnmatchedComunas: vi.fn(() => ({
    data: [
      { comuna_raw: 'San miguel', order_count: 12 },
      { comuna_raw: 'LA REINA',   order_count: 3  },
    ],
    isLoading: false,
  })),
  useMapComunaAlias: vi.fn(() => ({ mutate: mockMapMutate, isPending: false })),
}));

vi.mock('@/hooks/distribution/useChileComunas', () => ({
  useChileComunas: vi.fn(() => ({
    data: [
      { id: 'c-sm', nombre: 'San Miguel', region: 'RM', region_num: 13 },
      { id: 'c-lr', nombre: 'La Reina',   region: 'RM', region_num: 13 },
    ],
    isLoading: false,
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('UnmatchedComunasPanel', () => {
  it('renders unmatched communes with order counts', () => {
    render(<UnmatchedComunasPanel operatorId="op-1" />);
    expect(screen.getByText('San miguel')).toBeInTheDocument();
    expect(screen.getByText('LA REINA')).toBeInTheDocument();
  });

  it('renders a Mapear button for each unmatched row', () => {
    render(<UnmatchedComunasPanel operatorId="op-1" />);
    expect(screen.getAllByRole('button', { name: /mapear/i })).toHaveLength(2);
  });

  it('opens dialog with commune combobox when Mapear is clicked', async () => {
    render(<UnmatchedComunasPanel operatorId="op-1" />);
    fireEvent.click(screen.getAllByRole('button', { name: /mapear/i })[0]);
    expect(await screen.findByPlaceholderText(/buscar/i)).toBeInTheDocument();
  });

  it('calls map mutation on confirm', async () => {
    render(<UnmatchedComunasPanel operatorId="op-1" />);
    fireEvent.click(screen.getAllByRole('button', { name: /mapear/i })[0]);
    fireEvent.click(await screen.findByText('San Miguel'));
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    await waitFor(() => {
      expect(mockMapMutate).toHaveBeenCalledWith(
        { alias: 'San miguel', comunaId: 'c-sm' },
        expect.anything()
      );
    });
  });

  it('renders nothing when no unmatched communes', () => {
    vi.mocked(_useUnmatchedComunas).mockReturnValueOnce({ data: [], isLoading: false } as ReturnType<typeof _useUnmatchedComunas>);
    render(<UnmatchedComunasPanel operatorId="op-1" />);
    expect(screen.queryByRole('button', { name: /mapear/i })).not.toBeInTheDocument();
  });
});
