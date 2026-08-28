import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SealPositionCard } from './SealPositionCard';

const mockSealPosition = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/dispatch/useSealLoadPosition', () => ({
  useSealLoadPosition: () => ({ sealPosition: mockSealPosition, isSealing: false }),
}));

/**
 * The card is collapsed by default (review fix #1: an always-armed ScanField
 * stole the gun's input from the package field). Every scan therefore has to
 * reveal the field first — which is the operator's real gesture too.
 */
function reveal() {
  fireEvent.click(screen.getByRole('button', { name: 'Sellar posición' }));
}

function scan(code: string) {
  const input = screen.getByLabelText('Escanear posición a sellar');
  fireEvent.change(input, { target: { value: code } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

beforeEach(() => vi.clearAllMocks());

describe('SealPositionCard', () => {
  it('seals the scanned position and shows the success result', async () => {
    mockSealPosition.mockResolvedValue({
      ok: true,
      alreadySealed: false,
      sealedStops: 3,
      positionCode: 'POS-04',
    });

    render(<SealPositionCard />);
    reveal();
    scan('POS-04');

    expect(await screen.findByText(/Posición sellada · 3 parada\(s\)/)).toBeInTheDocument();
    expect(screen.getByTestId('scan-result-code')).toHaveTextContent('POS-04');
    expect(mockSealPosition).toHaveBeenCalledWith('POS-04');
  });

  it('shows an idempotent-success message on a repeat tap', async () => {
    mockSealPosition.mockResolvedValue({ ok: true, alreadySealed: true, positionCode: 'POS-04' });

    render(<SealPositionCard />);
    reveal();
    scan('POS-04');

    expect(await screen.findByText('Posición ya estaba sellada')).toBeInTheDocument();
  });

  it('shows the server refusal (e.g. UNSEALED_STOPS) as an error result', async () => {
    mockSealPosition.mockResolvedValue({
      ok: false,
      message: 'Faltan 2 parada(s) por estibar. Escanéalas o pide a un responsable que las quite de la planificación.',
    });

    render(<SealPositionCard />);
    reveal();
    scan('POS-04');

    expect(await screen.findByText(/Faltan 2 parada\(s\) por estibar/)).toBeInTheDocument();
    expect(screen.getByTestId('scan-result-icon-error')).toBeInTheDocument();
  });

  it('is collapsed on mount, so it mounts no ScanField to steal the gun from the package field', () => {
    render(<SealPositionCard />);

    expect(screen.queryByLabelText('Escanear posición a sellar')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sellar posición' })).toBeInTheDocument();
  });

  it('arms the field only once the operator taps, and disarms it again on Cancelar', () => {
    render(<SealPositionCard />);
    reveal();

    const input = screen.getByLabelText('Escanear posición a sellar');
    expect(input).toBeInTheDocument();
    expect(document.activeElement).toBe(input);

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByLabelText('Escanear posición a sellar')).not.toBeInTheDocument();
  });
});
