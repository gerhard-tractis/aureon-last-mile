import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import CompletionPage from './page';

const mockUsePickupScans = vi.fn();
vi.mock('@/hooks/pickup/usePickupScans', () => ({
  usePickupScans: (...args: unknown[]) => mockUsePickupScans(...args),
}));

const mockUseMissingPackages = vi.fn();
vi.mock('@/hooks/pickup/useDiscrepancies', () => ({
  useMissingPackages: (...args: unknown[]) => mockUseMissingPackages(...args),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1', userId: 'user-1' }),
}));

const mockRpc = vi.fn(() => Promise.resolve({ data: [{ out_verified_count: 2 }], error: null }));
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => {
    const makeSingle = (data: unknown) => ({
      single: () => Promise.resolve({ data }),
      eq: () => ({ single: () => Promise.resolve({ data }) }),
      is: () => ({ single: () => Promise.resolve({ data }) }),
    });
    const makeEq = (data: unknown) => ({
      eq: () => ({
        eq: () => ({
          is: () => ({ single: () => Promise.resolve({ data }) }),
        }),
        single: () => Promise.resolve({ data }),
      }),
      single: () => Promise.resolve({ data }),
    });
    return {
      from: (table: string) => {
        if (table === 'users') {
          return {
            select: () => makeEq({ full_name: 'Test User' }),
          };
        }
        return {
          select: () => makeEq({ id: 'm1', started_at: new Date().toISOString() }),
        };
      },
      rpc: mockRpc,
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }),
      },
    };
  },
}));

vi.mock('@/components/pickup/SignaturePad', () => ({
  SignaturePad: ({
    label,
    onChange,
  }: {
    label: string;
    onChange: (sig: string) => void;
  }) => (
    <button
      type="button"
      data-testid={`signature-pad-${label}`}
      onClick={() => onChange('data:image/png;base64,FAKE')}
    >
      {label}
    </button>
  ),
}));

vi.mock('@/components/pickup/PickupStepBreadcrumb', () => ({
  PickupStepBreadcrumb: () => <div data-testid="breadcrumb" />,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ loadId: 'CARGA-001' }),
  useRouter: () => ({ push: mockPush }),
}));

// M4, ronda 1 de review del PR #679 — sin este mock (y el test de abajo),
// nada en este fichero ejercitaba la forma REAL que `supabase.rpc()`
// resuelve sin señal. Los otros tests de arriba pasan `{ message: '...' }`
// desnudo — nunca la forma que `postgrest-js` produce de verdad
// (`{message, details, hint, code: ''}`, ver `closeManifestErrors.ts`) — así
// que ninguno de ellos podía haber atrapado B1.
const mockEnqueue = vi.fn();
vi.mock('@/lib/offline/queue', () => ({
  enqueue: (...args: unknown[]) => mockEnqueue(...args),
}));

// Decisión del usuario, 2026-09-08 (ronda 4 de review del PR #679, B-1 y
// menor 5) — `5f` no montaba ningún indicador de bloqueo ni afordancia de
// reintento; es justo la pantalla que hace la promesa "se sube al recuperar
// señal".
const mockUseSyncQueue = vi.fn();
vi.mock('@/hooks/useSyncQueue', () => ({
  useSyncQueue: (...args: unknown[]) => mockUseSyncQueue(...args),
}));

const mockRetryBlockedManifest = vi.fn();
vi.mock('@/hooks/useOfflineQueue', () => ({
  retryBlockedManifest: (...args: unknown[]) => mockRetryBlockedManifest(...args),
  PICKUP_QUEUE_WAKE_EVENT: 'aureon:pickup-queue-wake',
}));

describe('CompletionPage', () => {
  beforeEach(() => {
    mockUsePickupScans.mockReturnValue({
      data: [
        { id: 's1', scan_result: 'verified' },
        { id: 's2', scan_result: 'verified' },
      ],
    });
    mockUseMissingPackages.mockReturnValue({
      data: [{ id: 'pkg1', label: 'PKG-001' }],
    });
    mockUseSyncQueue.mockReturnValue({
      status: 'online',
      queuedCount: 0,
      blockedCount: 0,
      recent: [],
      retryNow: vi.fn(),
      isRetrying: false,
    });
    // M-3, ronda 5 de review del PR #679 (mayor) — por defecto simula "sí
    // había algo que revivir"; el test dedicado abajo lo sobreescribe con 0.
    mockRetryBlockedManifest.mockResolvedValue(1);
  });

  it('renders Spanish header', async () => {
    render(<CompletionPage />);
    expect(await screen.findByText('Firma y finalización')).toBeInTheDocument();
  });

  it('renders MetricCards with Spanish labels', async () => {
    render(<CompletionPage />);
    expect(await screen.findByText('Verificados')).toBeInTheDocument();
    expect(screen.getByText('Faltantes (con nota)')).toBeInTheDocument();
    expect(screen.getByText('Precisión')).toBeInTheDocument();
    expect(screen.getByText('Duración')).toBeInTheDocument();
  });

  it('renders MetricCards with data-value attributes', async () => {
    const { container } = render(<CompletionPage />);
    await screen.findByText('Verificados');
    const valueEls = container.querySelectorAll('[data-value]');
    expect(valueEls).toHaveLength(4);
    expect(valueEls[0].textContent).toBe('2');  // verified
    expect(valueEls[1].textContent).toBe('1');  // missing
  });

  it('renders Spanish legal notice', async () => {
    render(<CompletionPage />);
    expect(await screen.findByText('Aviso de transferencia de custodia')).toBeInTheDocument();
    expect(screen.getByText(/Al firmar, el operador confirma/)).toBeInTheDocument();
  });

  it('renders Spanish signature labels', async () => {
    render(<CompletionPage />);
    expect(await screen.findByText(/Firma del operador/)).toBeInTheDocument();
  });

  // Decisión del usuario, 2026-09-08 (ronda 3 de review del PR #679) — el
  // mock de `5f` (`docs/design/Recogida.dc.html`, PR #685) tiene esta línea
  // ESTÁTICA, siempre visible, ANTES de que el operario firme — no como
  // reacción a un fallo. Antes de esta ronda la pantalla sólo explicaba el
  // offline DESPUÉS de un error (un toast tras el fallo del RPC): afordancias
  // opuestas — el mock tranquiliza antes de decidir firmar, el código
  // mostraba un error y luego decía que en realidad había ido bien. El mock
  // nunca cubrió el camino de fallo en absoluto (cero coincidencias de
  // "error"/"reintentar"/"no se pudo" en todo el fichero), así que esa
  // afordancia se había inventado en tres rondas de review; el usuario
  // decidió mantener el toast como confirmación y AÑADIR esta línea, no
  // reemplazar una por otra. Texto literal del mock, sin parafrasear.
  it('shows the static offline-safety line before signing (verbatim from the 5f mock)', async () => {
    render(<CompletionPage />);
    expect(
      await screen.findByText(
        'Todo queda en el teléfono y se sube al recuperar señal. Las fotos también.',
      ),
    ).toBeInTheDocument();
  });

  // Menor 1, ronda 4 de review del PR #679 — el test anterior sólo hacía
  // `findByText` de la línea, sin comprobar su posición: mover el bloque
  // debajo de la firma habría pasado igual, y "antes de firmar" era el
  // criterio del propio mock (`docs/design/Recogida.dc.html`). Ancla el
  // orden con `compareDocumentPosition`.
  it('places the offline-safety line before the operator SignaturePad in document order', async () => {
    render(<CompletionPage />);
    const line = await screen.findByText(
      'Todo queda en el teléfono y se sube al recuperar señal. Las fotos también.',
    );
    const sigPad = await screen.findByTestId('signature-pad-Firma del operador (obligatoria)');

    // Bit 4 (DOCUMENT_POSITION_FOLLOWING) set on sigPad relative to line
    // means line comes first in the document.
    expect(line.compareDocumentPosition(sigPad) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // Decisión del usuario, 2026-09-08 (ronda 4 de review del PR #679, B-1 y
  // menor 5) — `5f` monta ahora un indicador de bloqueo con reintento, igual
  // que `PickupFlowHeader` en `5c`.
  describe('blocked entries (B-1, menor 5, ronda 4 de review del PR #679)', () => {
    it('shows nothing extra when nothing is blocked', async () => {
      render(<CompletionPage />);
      await screen.findByText('Firma y finalización');
      expect(screen.queryByTestId('blocked-badge')).not.toBeInTheDocument();
    });

    it('shows a retryable blocked indicator when something is blocked, and retries on tap', async () => {
      mockUseSyncQueue.mockReturnValue({
        status: 'online',
        queuedCount: 0,
        blockedCount: 1,
        recent: [],
        retryNow: vi.fn(),
        isRetrying: false,
      });
      render(<CompletionPage />);

      const badge = await screen.findByTestId('blocked-badge');
      expect(badge).toHaveTextContent(/requiere ayuda/i);

      fireEvent.click(badge);

      await waitFor(() => {
        expect(mockRetryBlockedManifest).toHaveBeenCalledWith('op-1', 'm1');
      });
    });

    // M-3, ronda 5 de review del PR #679 (mayor) — `blockedCount` incluye
    // bloqueos cross-user que este botón no puede resolver (sólo revive
    // `dead`). Sin feedback, el operario toca "REQUIERE AYUDA" y no ve
    // ningún cambio.
    it('shows an info toast when retryBlockedManifest revives nothing (a cross-user block, not a dead entry)', async () => {
      mockRetryBlockedManifest.mockResolvedValueOnce(0);
      mockUseSyncQueue.mockReturnValue({
        status: 'online',
        queuedCount: 0,
        blockedCount: 1,
        recent: [],
        retryNow: vi.fn(),
        isRetrying: false,
      });
      const { toast } = await import('sonner');
      render(<CompletionPage />);

      const badge = await screen.findByTestId('blocked-badge');
      fireEvent.click(badge);

      await waitFor(() => {
        expect(toast.info).toHaveBeenCalledWith(expect.any(String));
      });
    });
  });

  it('renders Spanish checkbox label', async () => {
    render(<CompletionPage />);
    expect(await screen.findByText('Agregar firma del cliente')).toBeInTheDocument();
  });

  it('renders Spanish button text', async () => {
    render(<CompletionPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /completar y generar recibo/i })).toBeInTheDocument();
    });
  });

  it('has responsive padding', async () => {
    const { container } = render(<CompletionPage />);
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain('sm:p-6');
  });

  it('calls close_manifest RPC (not a raw update) with p_manifest_id and p_signatures on confirm', async () => {
    render(<CompletionPage />);
    const sigPad = await screen.findByTestId('signature-pad-Firma del operador (obligatoria)');
    fireEvent.click(sigPad);

    const submitButton = await screen.findByRole('button', {
      name: /completar y generar recibo/i,
    });
    fireEvent.click(submitButton);

    const confirmButton = await screen.findByRole('button', {
      name: /confirmar y completar/i,
    });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      // H5 (fix round 1): operator_name is no longer sent — the RPC derives
      // the signer's name server-side from the JWT actor. A client-supplied
      // name would be worthless as custody-transfer evidence.
      expect(mockRpc).toHaveBeenCalledWith('close_manifest', {
        p_manifest_id: 'm1',
        p_signatures: {
          operator_signature: 'data:image/png;base64,FAKE',
          client_signature: null,
          client_name: null,
        },
      });
    });
  });

  // F3 (fix round 2): close_manifest raises in English with a sentinel
  // prefix (repo pattern — see app/api/dispatch/routes/[id]/blocks/route.ts
  // reading rpcError.code + message.startsWith(...)). A crew leader on an
  // all-Spanish PWA must never see that raw Postgres text.
  const completeAndSubmit = async () => {
    render(<CompletionPage />);
    const sigPad = await screen.findByTestId('signature-pad-Firma del operador (obligatoria)');
    fireEvent.click(sigPad);

    const submitButton = await screen.findByRole('button', {
      name: /completar y generar recibo/i,
    });
    fireEvent.click(submitButton);

    const confirmButton = await screen.findByRole('button', {
      name: /confirmar y completar/i,
    });
    fireEvent.click(confirmButton);
  };

  // P0, ronda 3 de review del PR #679 (bloqueante) — `classifyCloseManifestError`
  // distingue CUATRO `kind` desde la ronda 2 (`offline`/`idempotent`/
  // `permanent`/`transient`); esta pantalla sólo distinguía DOS (`offline` y
  // "todo lo demás"), así que `idempotent` caía al mismo `toast.error` +
  // botón re-habilitado que un rechazo permanente de verdad. Escenario: la
  // cuadrilla firma y tapea "Confirmar y completar". `close_manifest`
  // COMMITEA — manifiesto cerrado, firmas escritas — y la respuesta se
  // pierde en un túnel. El operario tapea otra vez, choca con
  // `MANIFEST_ALREADY_SIGNED` (23505) — que la propia migración documenta
  // como "an idempotent 409", el mismo cierre que YA SE APLICÓ — pero la
  // pantalla lo trataba como si nunca hubiera funcionado: toast rojo, sin
  // navegar, el operario atrapado en `5f` para siempre (refrescar no ayuda,
  // el `useEffect` recarga el mismo manifiesto). El drenador de fondo
  // (`offlineQueueSender.ts:98-103`) ya mapea `idempotent -> 'sent'`
  // correctamente — esta era la otra costura sobre la misma función de
  // clasificación que no se había alineado.
  it('MANIFEST_ALREADY_SIGNED (idempotent 409) is treated as success and navigates away — the close already applied', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'MANIFEST_ALREADY_SIGNED: manifest already has an operator signature' },
    });
    const { toast } = await import('sonner');

    await completeAndSubmit();

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/ya fue firmado/i));
    });
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/app/pickup');
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('maps MANIFEST_NOT_CLOSABLE to a Spanish message', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'MANIFEST_NOT_CLOSABLE: manifest is not in a closable state (status: pending)' },
    });
    const { toast } = await import('sonner');

    await completeAndSubmit();

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.any(String));
      const [message] = (toast.error as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(message).not.toContain('MANIFEST_NOT_CLOSABLE');
      expect(message).toMatch(/[áéíóúñ]/i);
    });
  });

  // M4, ronda 1 de review del PR #679 — el mock de RPC de abajo es la forma
  // EXACTA que `postgrest-js@1.21.4` resuelve cuando `fetch` rechaza sin
  // señal (`PostgrestBuilder.ts:218-229`, ver `closeManifestErrors.ts`), no
  // un `TypeError` inventado. Antes del fix de B1, esta forma se clasificaba
  // `business` (porque `'code' in err` era verdadero) y el operario sin
  // señal veía el toast de error genérico con nada encolado — exactamente
  // la regresión que este test existe para que no vuelva a pasar
  // desapercibida.
  it('queues the close and navigates away on the real postgrest-js network-fallback shape (offline, not business)', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'TypeError: Failed to fetch',
        details: 'TypeError: Failed to fetch\n    at fetch (...)',
        hint: '',
        code: '',
      },
    });
    const { toast } = await import('sonner');

    await completeAndSubmit();

    await waitFor(() => {
      expect(mockEnqueue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          operatorId: 'op-1',
          // B4, ronda 2 de review del PR #679 — sin `userId` en el payload
          // encolado, el drenador (`useOfflineQueue`) no tiene forma de
          // saber que esta entrada le pertenece a esta sesión.
          userId: 'user-1',
          manifestId: 'm1',
          type: 'close_manifest',
          payload: expect.objectContaining({
            manifestId: 'm1',
            signatures: expect.objectContaining({
              operator_signature: 'data:image/png;base64,FAKE',
            }),
          }),
        }),
      );
    });

    expect(toast.error).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/sin conexión|sin señal/i));
    });
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/app/pickup');
    });
  });

  // Nota menor de la ronda 6 de review del PR #679 — encolar offline aquí
  // no despertaba al drenador ya montado en `AppLayout`: descansaba en el
  // mismo supuesto de "ya vendrá un `online`" que el residual de la ronda 5
  // (S1/S2, `useOfflineQueue.test.ts`) mostró que no basta por sí solo.
  // Disparar `PICKUP_QUEUE_WAKE_EVENT` justo tras encolar hace que el envío
  // se intente de inmediato, en vez de esperar la próxima reconexión real.
  it('wakes the already-mounted drainer right after queuing the offline close, instead of waiting for the next real online event', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'TypeError: Failed to fetch',
        details: '',
        hint: '',
        code: '',
      },
    });
    const wakeListener = vi.fn();
    window.addEventListener('aureon:pickup-queue-wake', wakeListener);

    try {
      await completeAndSubmit();

      await waitFor(() => expect(wakeListener).toHaveBeenCalledTimes(1));
    } finally {
      window.removeEventListener('aureon:pickup-queue-wake', wakeListener);
    }
  });

  // M5, ronda 2 de review del PR #679 (mayor): `enqueue` corre DENTRO del
  // catch de `handleComplete`, sin un `try` propio — si `enqueue` mismo
  // lanza (el tope de 500 entradas sin confirmar de `queue.ts`, o cualquier
  // `DOMException` de IndexedDB: cuota, modo privado), la excepción escapaba
  // sin capturar. `setIsSubmitting(false)` nunca corría, el botón quedaba
  // deshabilitado con "Completando…" para siempre, sin toast, y la firma se
  // perdía — "fallo silencioso contra la cuota" se convertía en "fallo
  // silencioso con la pantalla colgada".
  it('M5 — when enqueue itself throws (e.g. the queue is full), shows an error and re-enables the button instead of hanging', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'TypeError: Failed to fetch',
        details: '',
        hint: '',
        code: '',
      },
    });
    mockEnqueue.mockRejectedValueOnce(
      new Error('recogida offline queue: cola llena (500 entradas sin confirmar)'),
    );
    const { toast } = await import('sonner');

    await completeAndSubmit();

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.any(String));
    });
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /completar y generar recibo/i }),
      ).not.toBeDisabled();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('falls back to a generic Spanish message for an unrecognized RPC error', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'manifest not found' },
    });
    const { toast } = await import('sonner');

    await completeAndSubmit();

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('No se pudo completar el manifiesto');
    });
  });
});
