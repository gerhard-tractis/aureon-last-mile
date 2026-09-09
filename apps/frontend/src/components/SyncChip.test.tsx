import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockState = {
  status: 'online' as 'online' | 'offline' | 'syncing',
  queuedCount: 0,
  blockedCount: 0,
  recent: [],
  retryNow: vi.fn(),
  isRetrying: false,
};

vi.mock('@/hooks/useSyncQueue', () => ({
  useSyncQueue: () => mockState,
}));

import { SyncChip } from './SyncChip';

beforeEach(() => {
  mockState.status = 'online';
  mockState.queuedCount = 0;
  mockState.blockedCount = 0;
});

describe('SyncChip', () => {
  it('renders nothing when online with an empty queue', () => {
    // The normal state needs no chrome; the old banner shipped one anyway.
    const { container } = render(<SyncChip />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says how much work is held when offline, not just that the link is down', () => {
    mockState.status = 'offline';
    mockState.queuedCount = 14;
    render(<SyncChip />);
    expect(screen.getByText('SIN CONEXIÓN · 14 EN COLA')).toBeInTheDocument();
  });

  it('still reports a backlog while online', () => {
    mockState.queuedCount = 3;
    render(<SyncChip />);
    expect(screen.getByText('3 EN COLA')).toBeInTheDocument();
  });

  it('announces itself politely rather than interrupting', () => {
    mockState.status = 'offline';
    mockState.queuedCount = 1;
    render(<SyncChip />);
    const chip = screen.getByTestId('sync-chip');
    expect(chip).toHaveAttribute('role', 'status');
    expect(chip).toHaveAttribute('aria-live', 'polite');
  });

  it('shows a syncing state while the queue drains', () => {
    mockState.status = 'syncing';
    mockState.queuedCount = 2;
    render(<SyncChip />);
    expect(screen.getByText('SINCRONIZANDO…')).toBeInTheDocument();
  });

  // B3, ronda 2 de review del PR #679 (bloqueante): un `dead` no puede
  // desaparecer dentro del verde de éxito de "N EN COLA" — es un bloqueo
  // permanente que necesita intervención humana, no algo que "va a salir
  // solo". El mínimo de esta ronda: deja de contarse dentro de "EN COLA" y
  // se anuncia aparte, con un tono distinto del de éxito. La afordancia
  // completa (botón, pantalla) es fase 4 — pendiente.
  describe('blockedCount (B3)', () => {
    it('renders (does not disappear) online with an empty retry queue but a blocked entry', () => {
      mockState.status = 'online';
      mockState.queuedCount = 0;
      mockState.blockedCount = 1;
      const { container } = render(<SyncChip />);
      expect(container).not.toBeEmptyDOMElement();
    });

    it('announces the blocked count as needing help, distinct from "EN COLA"', () => {
      mockState.status = 'online';
      mockState.queuedCount = 0;
      mockState.blockedCount = 1;
      render(<SyncChip />);
      expect(screen.getByText(/requiere ayuda/i)).toBeInTheDocument();
      expect(screen.queryByText(/en cola/i)).not.toBeInTheDocument();
    });

    it('does not use the success (green) tone while anything is blocked, even online with the retry queue drained', () => {
      mockState.status = 'online';
      mockState.queuedCount = 0;
      mockState.blockedCount = 1;
      render(<SyncChip />);
      const chip = screen.getByTestId('sync-chip');
      expect(chip.className).not.toMatch(/status-success/);
    });

    it('shows both the retryable count and the blocked count when both are present', () => {
      mockState.status = 'online';
      mockState.queuedCount = 3;
      mockState.blockedCount = 1;
      render(<SyncChip />);
      expect(screen.getByText(/3 EN COLA/)).toBeInTheDocument();
      expect(screen.getByText(/1 REQUIERE AYUDA/i)).toBeInTheDocument();
    });
  });
});
