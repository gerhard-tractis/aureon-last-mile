import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OfflinePickupNotice } from './OfflinePickupNotice';

describe('OfflinePickupNotice', () => {
  it('explains why scanning is disabled', () => {
    render(<OfflinePickupNotice downloadedAt={null} />);
    expect(screen.getByText(/sin conexión/i)).toBeInTheDocument();
  });

  it('warns that verified progress cannot be confirmed', () => {
    render(<OfflinePickupNotice downloadedAt={null} />);
    expect(
      screen.getByText(/no se puede (confirmar|mostrar) (lo|cuántos)/i),
    ).toBeInTheDocument();
  });

  it('shows when the snapshot was downloaded, when known', () => {
    render(<OfflinePickupNotice downloadedAt="2026-09-08T14:30:00.000Z" />);
    expect(screen.getByText(/descargad[oa]/i)).toBeInTheDocument();
  });

  it('does not claim a download time when there is none', () => {
    render(<OfflinePickupNotice downloadedAt={null} />);
    expect(screen.queryByText(/descargado el/i)).toBeNull();
  });

  // Menor, revisión de fase 2 (ronda 3) — un caché SIN invalidación
  // automática puede quedar viejo por días; "08/09 11:30" sin año no dice
  // si es de hoy o del año pasado.
  it('includes the year — this cache has no automatic invalidation and can go stale for a long time', () => {
    render(<OfflinePickupNotice downloadedAt="2026-09-08T14:30:00.000Z" />);
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  // Menor, ronda 4 de review del PR #727 — `/2026/` + `/descargad[oa]/i`
  // pasan igual si día y mes se invierten (`formatDownloadedAt` los arma a
  // mano, sin Intl). Afirma el string exacto DD/MM/AAAA, con un literal
  // hardcodeado (NO recalculado con la misma fórmula del componente, que
  // dejaría pasar un swap simétrico) y una fecha SIN sufijo `Z` para que el
  // resultado no dependa de la zona horaria del runner.
  it('formats the date as DD/MM/AAAA HH:MM, not MM/DD (day/month swap mutant)', () => {
    render(<OfflinePickupNotice downloadedAt="2026-09-08T14:30:00" />);
    expect(screen.getByText(/08\/09\/2026 14:30/)).toBeInTheDocument();
  });
});
