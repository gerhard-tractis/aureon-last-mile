/**
 * spec-82 fase 2, revisión B2 (ronda 3) — "el texto declara; la interfaz
 * miente más fuerte". El banner offline decía "no se puede confirmar
 * cuántos bultos ya se verificaron", pero `scanned={verifiedCount}` seguía
 * siendo `0` (numérico, 32px, negrita, color de marca), con "0%", la barra
 * vacía, `aria-valuenow={0}` y "0/N" en cada orden — cinco afirmaciones
 * numéricas de que no se hizo nada, más fuertes que una línea de 12px
 * diciendo que quizá no sea cierto.
 *
 * `scanned: number | null` — `null` es el tercer estado ("no lo sé", no
 * "cero") y pinta "—" con la barra en indeterminado, nunca un 0 fabricado.
 * Fichero separado de `PickupFlowHeader.test.tsx` sólo por tamaño (ese
 * archivo ya está en 330 líneas).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PickupFlowHeader } from './PickupFlowHeader';

function baseProps(overrides: Partial<Parameters<typeof PickupFlowHeader>[0]> = {}) {
  return {
    loadId: 'CARGA-99817',
    retailerName: 'Ripley',
    pickupPoint: 'Parque Arauco',
    scanned: null,
    total: 25,
    queuedCount: 0,
    blockedCount: 0,
    ...overrides,
  };
}

describe('PickupFlowHeader — scanned: null (B2, ronda 3)', () => {
  it('shows "—" instead of a fabricated 0 when scanned is null', () => {
    render(<PickupFlowHeader {...baseProps()} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('does not show a percentage when scanned is null', () => {
    render(<PickupFlowHeader {...baseProps()} />);
    expect(screen.queryByText('0%')).toBeNull();
  });

  it('marks the progress bar as indeterminate (no aria-valuenow) when scanned is null', () => {
    render(<PickupFlowHeader {...baseProps()} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).not.toHaveAttribute('aria-valuenow');
  });

  it('still renders the real number and percentage when scanned is a known value', () => {
    render(<PickupFlowHeader {...baseProps({ scanned: 18 })} />);
    expect(screen.getByText('18')).toBeInTheDocument();
    expect(screen.getByText('72%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '18');
  });
});
