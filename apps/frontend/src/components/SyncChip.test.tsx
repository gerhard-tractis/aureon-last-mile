import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PickupQueueEntry } from '@/lib/db';

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

// spec-81 fase 4 — el detalle detrás de `blockedCount`. Estado propio para
// que cada test controle exactamente qué ve el panel sin tocar IndexedDB.
const mockDetail: {
  status: 'idle' | 'ok' | 'error';
  entries: Partial<PickupQueueEntry>[];
  sameManifestBlockedCount: number;
  crossUserBlockedCount: number;
} = {
  status: 'idle',
  entries: [],
  sameManifestBlockedCount: 0,
  crossUserBlockedCount: 0,
};

vi.mock('@/hooks/useBlockedPickupEntries', () => ({
  useBlockedPickupEntries: () => mockDetail,
}));

import { SyncChip } from './SyncChip';

beforeEach(() => {
  mockState.status = 'online';
  mockState.queuedCount = 0;
  mockState.blockedCount = 0;
  mockDetail.status = 'idle';
  mockDetail.entries = [];
  mockDetail.sameManifestBlockedCount = 0;
  mockDetail.crossUserBlockedCount = 0;
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

  // spec-81 fase 4 — la afordancia completa que la ronda 2 de review del
  // PR #679 dejó pendiente: qué manifiesto está bloqueado, por qué
  // (`lastError`), si eso detiene el cierre de esa carga o no (una foto
  // muerta no lo hace), y una vía para que un humano lo resuelva.
  describe('blocked detail (afordancia humana)', () => {
    it('renders no detail disclosure while nothing is blocked', () => {
      render(<SyncChip />);
      expect(screen.queryByTestId('sync-chip-detail-toggle')).not.toBeInTheDocument();
    });

    it('offers a detail disclosure once something is blocked', () => {
      mockState.blockedCount = 1;
      render(<SyncChip />);
      expect(screen.getByTestId('sync-chip-detail-toggle')).toBeInTheDocument();
    });

    // Menor, ronda 2 de review del PR #725 — con `blockedCount > 0` pero el
    // hook todavía en `idle` (el instante entre el mount y su primera
    // lectura), el panel no puede quedar en blanco: el chip ya dice "N
    // REQUIERE AYUDA", así que abrir "Ver detalle" y encontrar una caja
    // vacía es peor que decir "cargando".
    it('never renders a blank panel while the hook has not resolved yet', () => {
      mockState.blockedCount = 1;
      mockDetail.status = 'idle';
      render(<SyncChip />);
      const panel = screen.getByTestId('sync-chip-detail');
      expect(panel.textContent).not.toBe('');
    });

    it('names the blocked manifest and the reason it was rejected', () => {
      mockState.blockedCount = 1;
      mockDetail.status = 'ok';
      mockDetail.entries = [
        { id: 1, manifestId: 'manifest-77', type: 'pickup_scan', lastError: 'MANIFEST_NOT_CLOSABLE' },
      ];
      render(<SyncChip />);
      expect(screen.getAllByText(/manifest-77/).length).toBeGreaterThan(0);
      expect(screen.getByText(/MANIFEST_NOT_CLOSABLE/)).toBeInTheDocument();
    });

    it('says a pickup_scan/close_manifest rejection blocks closing that load', () => {
      mockState.blockedCount = 1;
      mockDetail.status = 'ok';
      mockDetail.entries = [
        { id: 1, manifestId: 'manifest-77', type: 'pickup_scan', lastError: 'MANIFEST_NOT_CLOSABLE' },
      ];
      render(<SyncChip />);
      // M2, ronda 2 de review del PR #725 — regex anclada: sin esto, "No
      // bloquea el cierre…" (la rama contraria) también matchea
      // `/bloquea el cierre/i` como substring, y el test no discrimina nada.
      expect(screen.getByText(/^Bloquea el cierre/)).toBeInTheDocument();
      expect(screen.queryByText(/es respaldo/i)).not.toBeInTheDocument();
    });

    // La distinción exacta que la fase 5 (photos-send.ts) introdujo hoy:
    // una foto muerta SIGUE contando como bloqueada (blockedCount), pero
    // manifestHasDeadEntry ya no la usa para frenar el close_manifest. El
    // chip miente si no dice la diferencia.
    it('says a dead manifest_photo does NOT block closing the load — it is backup, not count', () => {
      mockState.blockedCount = 1;
      mockDetail.status = 'ok';
      mockDetail.entries = [
        { id: 1, manifestId: 'manifest-77', type: 'manifest_photo', lastError: 'sheet_number collision' },
      ];
      render(<SyncChip />);
      expect(screen.getByText(/es respaldo/i)).toBeInTheDocument();
      expect(screen.queryByText(/^Bloquea el cierre/)).not.toBeInTheDocument();
    });

    // El caso puro cross-user: blockedCount > 0 sólo por una `pending`
    // detrás de otro operario, sin ningún `dead` de por medio.
    // `listDeadPickupEntries` no trae nada, y el panel no puede quedarse en
    // silencio — tiene que decir que lo bloqueado no es un rechazo, se
    // libera solo.
    it('says nothing needs help when blocked is entirely a temporary cross-user wait, no dead entries at all', () => {
      mockState.blockedCount = 1;
      mockDetail.status = 'ok';
      mockDetail.entries = [];
      mockDetail.crossUserBlockedCount = 1;
      render(<SyncChip />);
      expect(screen.getByText(/nada requiere ayuda/i)).toBeInTheDocument();
      // Nadie necesita abrir ninguna carga por algo que se resuelve solo.
      expect(screen.queryByText(/toca “requiere ayuda”/i)).not.toBeInTheDocument();
    });

    // M3, ronda 2 de review del PR #725 — con un `dead` listado, la rama
    // "nada requiere ayuda" no puede aparecer a la vez: eso es
    // contradictorio (la carga de arriba SÍ requiere ayuda).
    it('does not say "nothing needs help" when a dead entry is listed', () => {
      mockState.blockedCount = 1;
      mockDetail.status = 'ok';
      mockDetail.entries = [
        { id: 1, manifestId: 'manifest-77', type: 'pickup_scan', lastError: 'MANIFEST_NOT_CLOSABLE' },
      ];
      render(<SyncChip />);
      expect(screen.queryByText(/nada requiere ayuda/i)).not.toBeInTheDocument();
    });

    // M1, ronda 2 de review del PR #725 — `retryDead` ya existe y ya está
    // cableado al botón "REQUIERE AYUDA" de `complete/[loadId]/page.tsx`.
    // Mandar a soporte por algo que el propio operario puede resolver con
    // un toque nombra al actor equivocado.
    it('points to the existing retry affordance on that load, not to support', () => {
      mockState.blockedCount = 1;
      mockDetail.status = 'ok';
      mockDetail.entries = [
        {
          id: 1,
          manifestId: 'manifest-77',
          externalLoadId: 'CARGA-001',
          type: 'pickup_scan',
          lastError: 'MANIFEST_NOT_CLOSABLE',
        },
      ];
      render(<SyncChip />);
      expect(screen.getByText(/CARGA-001.*requiere ayuda/is)).toBeInTheDocument();
      expect(screen.queryByText(/contacta a soporte/i)).not.toBeInTheDocument();
    });

    // M, ronda 3 de review del PR #725 (mayor) — `manifestId` es un UUID
    // (`manifests.id`), sin significado ni utilidad de navegación para el
    // operario. "Abre la carga 3f2a9c8e-4b1d-…" no es una instrucción
    // ejecutable — sólo `externalLoadId` lo es.
    it('never tells the operator to open a load by its internal UUID', () => {
      mockState.blockedCount = 1;
      mockDetail.status = 'ok';
      mockDetail.entries = [
        {
          id: 1,
          manifestId: '3f2a9c8e-4b1d-4a1e-9c3a-abcdef123456',
          externalLoadId: 'CARGA-001',
          type: 'pickup_scan',
          lastError: 'MANIFEST_NOT_CLOSABLE',
        },
      ];
      render(<SyncChip />);
      expect(screen.queryByText(/abre la carga 3f2a9c8e/i)).not.toBeInTheDocument();
      expect(screen.getByText(/abre la carga carga-001/i)).toBeInTheDocument();
      // El encabezado "Carga X" también prefiere el id navegable — mostrar
      // el UUID ahí, aunque no sea una instrucción, sigue sin decirle nada
      // al operario que la instrucción de abajo sí puede aprovechar.
      expect(screen.queryByText(/^Carga 3f2a9c8e/)).not.toBeInTheDocument();
      expect(screen.getByText('Carga CARGA-001')).toBeInTheDocument();
    });

    // Sin `externalLoadId` (ningún llamador de `pickup_scan`/
    // `manifest_photo` lo pasa todavía) el chip no puede fingir una
    // instrucción de navegación que no puede cumplir.
    it('falls back to a generic (still actionable) instruction when externalLoadId is not available', () => {
      mockState.blockedCount = 1;
      mockDetail.status = 'ok';
      mockDetail.entries = [
        { id: 1, manifestId: 'manifest-77', type: 'pickup_scan', lastError: 'MANIFEST_NOT_CLOSABLE' },
      ];
      render(<SyncChip />);
      expect(screen.queryByText(/abre la carga manifest-77/i)).not.toBeInTheDocument();
      expect(screen.getByText(/ábrela desde recogida.*requiere ayuda/is)).toBeInTheDocument();
    });

    // B1, ronda 2 de review del PR #725 (bloqueante) — el resto de
    // `blockedCount` que un `dead` en el MISMO manifiesto bloquea NO se
    // libera solo (ninguna otra persona involucrada); confundirlo con
    // espera cross-user es la misma mentira que este módulo lleva rondas
    // cerrando en otros sitios.
    it('attributes extra blocked entries to the same load above when that is what blocks them — never "se liberan solas"', () => {
      mockState.blockedCount = 5;
      mockDetail.status = 'ok';
      mockDetail.entries = [
        { id: 1, manifestId: 'manifest-77', type: 'close_manifest', lastError: 'MANIFEST_NOT_CLOSABLE' },
      ];
      mockDetail.sameManifestBlockedCount = 4;
      mockDetail.crossUserBlockedCount = 0;
      render(<SyncChip />);
      expect(screen.getByText(/\+4 más bloqueadas por la misma carga/i)).toBeInTheDocument();
      expect(screen.queryByText(/se liberan solas/i)).not.toBeInTheDocument();
    });

    it('attributes extra blocked entries to another operator only when nothing dead explains them', () => {
      mockState.blockedCount = 3;
      mockDetail.status = 'ok';
      mockDetail.entries = [
        { id: 1, manifestId: 'manifest-77', type: 'pickup_scan', lastError: 'MANIFEST_NOT_CLOSABLE' },
      ];
      mockDetail.sameManifestBlockedCount = 0;
      mockDetail.crossUserBlockedCount = 2;
      render(<SyncChip />);
      expect(screen.getByText(/\+2 más esperando a otro operario; se liberan solas/i)).toBeInTheDocument();
    });

    it('does not claim there is more when the dead list already accounts for all of blockedCount', () => {
      mockState.blockedCount = 1;
      mockDetail.status = 'ok';
      mockDetail.entries = [
        { id: 1, manifestId: 'manifest-77', type: 'pickup_scan', lastError: 'MANIFEST_NOT_CLOSABLE' },
      ];
      mockDetail.sameManifestBlockedCount = 0;
      mockDetail.crossUserBlockedCount = 0;
      render(<SyncChip />);
      expect(screen.queryByText(/\+0/)).not.toBeInTheDocument();
      expect(screen.queryByText(/más esperando/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/más bloqueadas/i)).not.toBeInTheDocument();
    });

    it('distinguishes a failed read from "nothing is blocked" — never a silent zero', () => {
      mockState.blockedCount = 1;
      mockDetail.status = 'error';
      mockDetail.entries = [];
      render(<SyncChip />);
      expect(screen.getByText(/no se pudo cargar/i)).toBeInTheDocument();
      expect(screen.queryByText(/nada requiere ayuda/i)).not.toBeInTheDocument();
    });
  });
});
