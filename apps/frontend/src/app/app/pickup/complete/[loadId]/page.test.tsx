import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import CompletionPage from './page';

// Ronda 2 de review del PR #736 (M1) — el doble anterior descartaba TODOS
// los props, así que borrar `externalLoadId={loadId}` en `page.tsx` no lo
// detectaba ningún test (26/26 seguían en verde). Registrarlos es lo que
// convierte este mock en una guardia real del eslabón page → strip, no sólo
// en un placeholder visual.
const mockManifestPhotoStripProps: Array<Record<string, unknown>> = [];
vi.mock('@/components/pickup/ManifestPhotoStrip', () => ({
  ManifestPhotoStrip: (props: Record<string, unknown>) => {
    mockManifestPhotoStripProps.push(props);
    return <div data-testid="manifest-photo-strip" />;
  },
}));

// Ronda 2 de review de spec-95 fase 7 (hallazgo 3, mayor) — mismo patrón que
// `ManifestPhotoStrip` arriba: `CustodyConfirmationSheet` tiene su propia
// suite exhaustiva (`CustodyConfirmationSheet.test.tsx` — título, copy,
// tirador, Firmas/Respaldo en sus dos ramas, foco, `role`, botón Close
// oculto). Aquí sólo importa el CABLEADO página → hoja: sin este doble que
// registra los props recibidos, una mutación que sustituye
// `serverPhotosCount`/`queuedPhotosCount`/`isSubmitting` por literales fijos
// pasaba los 45/45 tests de este fichero — la hoja que TRANSFIERE CUSTODIA
// habría dicho "Respaldo: 0 fotos" con fotos reales confirmadas, y nada lo
// habría atrapado. El doble no cierra solo al confirmar (a diferencia del
// componente real, que si cierra) — así puede quedarse abierto el tiempo
// suficiente para que un test lea `isSubmitting` en pleno vuelo.
const mockCustodySheetProps: Array<Record<string, unknown>> = [];
vi.mock('@/components/pickup/CustodyConfirmationSheet', () => ({
  CustodyConfirmationSheet: (props: Record<string, unknown>) => {
    mockCustodySheetProps.push(props);
    if (!props.open) return null;
    return (
      <div data-testid="custody-sheet-mock">
        <button type="button" onClick={() => (props.onConfirm as () => void)()}>
          Sí, cerrar la carga
        </button>
        <button
          type="button"
          onClick={() => (props.onOpenChange as (open: boolean) => void)(false)}
        >
          Volver a revisar
        </button>
      </div>
    );
  },
}));

const mockUsePickupScans = vi.fn();
vi.mock('@/hooks/pickup/usePickupScans', () => ({
  usePickupScans: (...args: unknown[]) => mockUsePickupScans(...args),
}));

const mockUseMissingPackages = vi.fn();
vi.mock('@/hooks/pickup/useDiscrepancies', () => ({
  useMissingPackages: (...args: unknown[]) => mockUseMissingPackages(...args),
}));

// spec-80 fase 5 (5i) — "Respaldo" photo count and "Sigue en PR-…" pending
// route figures. Mocked the same way as the other data hooks above: this
// page renders under plain `render()`, no QueryClientProvider.
const mockUseManifestDocuments = vi.fn();
vi.mock('@/hooks/pickup/useManifestDocuments', () => ({
  useManifestDocuments: (...args: unknown[]) => mockUseManifestDocuments(...args),
}));

// Ronda 4 de review del PR #736 (bloqueante 2) — "Respaldo" debe contar
// también lo encolado sin confirmar, no sólo `documents.length`.
const mockUseQueuedManifestPhotoCount = vi.fn();
vi.mock('@/hooks/pickup/useQueuedManifestPhotoCount', () => ({
  useQueuedManifestPhotoCount: (...args: unknown[]) => mockUseQueuedManifestPhotoCount(...args),
}));

const mockUseRouteManifests = vi.fn();
vi.mock('@/hooks/pickup/useRouteManifests', () => ({
  useRouteManifests: (...args: unknown[]) => mockUseRouteManifests(...args),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1', userId: 'user-1' }),
}));

// m5, ronda 2 de review de spec-95 fase 6 — mutable para que un test pueda
// simular `retailer_name: null` (ningún test lo recorría antes; el doble
// siempre devolvía 'Falabella'). Reseteada en `beforeEach`.
let mockManifestRow: { id: string; started_at: string; retailer_name: string | null } = {
  id: 'm1',
  started_at: new Date().toISOString(),
  retailer_name: 'Falabella',
};

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
          // spec-95 fase 6 — `retailer_name` añadido al doble para poder
          // anclar la cabecera del mock (`CARGA-… · <cliente>`); leído de
          // `mockManifestRow` (mutable) para que m5 pueda simular
          // `retailer_name: null`.
          select: () => makeEq(mockManifestRow),
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
    mockManifestPhotoStripProps.length = 0;
    mockCustodySheetProps.length = 0;
    mockManifestRow = {
      id: 'm1',
      started_at: new Date().toISOString(),
      retailer_name: 'Falabella',
    };
    mockUsePickupScans.mockReturnValue({
      data: [
        { id: 's1', scan_result: 'verified', package_id: 'pkg-a' },
        { id: 's2', scan_result: 'verified', package_id: 'pkg-b' },
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
    mockUseManifestDocuments.mockReturnValue({ data: [] });
    mockUseQueuedManifestPhotoCount.mockReturnValue(0);
    mockUseRouteManifests.mockReturnValue({ data: [] });
    // M-3, ronda 5 de review del PR #679 (mayor) — por defecto simula "sí
    // había algo que revivir"; el test dedicado abajo lo sobreescribe con 0.
    mockRetryBlockedManifest.mockResolvedValue(1);
  });

  it('renders Spanish header', async () => {
    render(<CompletionPage />);
    expect(await screen.findByText('Firma y finalización')).toBeInTheDocument();
  });

  // spec-95 fase 6, mock `5f` — el título grande va ARRIBA del subtítulo
  // mono `CARGA-… · <cliente>`, al revés de como estaba antes de esta fase
  // (loadId arriba, título abajo).
  it('places the "Firma y finalización" title above the "CARGA-… · cliente" subtitle, per the 5f mock', async () => {
    render(<CompletionPage />);
    const title = await screen.findByText('Firma y finalización');
    const subtitle = await screen.findByText('CARGA-001 · Falabella');
    expect(title.compareDocumentPosition(subtitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // M3, ronda 2 de review — el mock (`Recogida.dc.html:793`) pinta
  // "CARGA-99814 · Falabella" en JetBrains Mono, el mismo mono que
  // distingue un id de carga en toda la app; el commit anterior lo llamó
  // "subtítulo mono" sin llevar la clase.
  it('renders the "CARGA-… · cliente" subtitle in monospace, per the mock', async () => {
    render(<CompletionPage />);
    const subtitle = await screen.findByText('CARGA-001 · Falabella');
    expect(subtitle.className).toContain('font-mono');
  });

  // m5, ronda 2 de review — sin cliente conocido (retailerName null), el
  // subtítulo cae a sólo el loadId, sin " · null" colgando. No lo recorría
  // ningún test: el doble de Supabase siempre devolvía "Falabella".
  it('falls back to just the loadId when retailerName is not known yet', async () => {
    mockManifestRow = {
      id: 'm1',
      started_at: new Date().toISOString(),
      retailer_name: null,
    };
    render(<CompletionPage />);
    expect(await screen.findByText('CARGA-001')).toBeInTheDocument();
    expect(screen.queryByText(/CARGA-001 ·/)).not.toBeInTheDocument();
  });

  it('renders MetricCards with Spanish labels', async () => {
    render(<CompletionPage />);
    expect(await screen.findByText('Verificados')).toBeInTheDocument();
    expect(screen.getByText('Faltantes (con nota)')).toBeInTheDocument();
    expect(screen.getByText('Precisión')).toBeInTheDocument();
    expect(screen.getByText('Duración')).toBeInTheDocument();
  });

  // spec-95 fase 6, mock `5f` — "FALTANTES (CON NOTA)" se dibuja en DOS
  // líneas porque en una se cortaba (defecto real que encontró el
  // recorrido de QA del 2026-09-10). `getByText` normaliza el whitespace
  // (un `\n` interno pasa a ser un espacio), así que el texto accesible
  // sigue siendo "Faltantes (con nota)" — lo que ancla el arreglo es que
  // el nodo YA NO recorta con elipsis (`truncate`).
  // B4, ronda 2 de review — comprobar sólo `textContent` y la AUSENCIA de
  // `truncate` no prueba que el arreglo se haya hecho: quitar
  // `whitespace-pre-line` (el CSS que rompe la línea) deja pasar ambas
  // aserciones igual, porque el `\n` sigue en el DOM. Se añade la
  // aserción positiva de la clase.
  it('renders the missing-count label across two lines, without truncating it (the bug the mock fixed)', async () => {
    render(<CompletionPage />);
    const label = await screen.findByText('Faltantes (con nota)');
    expect(label.textContent).toBe('Faltantes\n(con nota)');
    expect(label.className).toContain('whitespace-pre-line');
    expect(label.className).not.toContain('truncate');
  });

  it('renders MetricCards with data-value attributes', async () => {
    const { container } = render(<CompletionPage />);
    await screen.findByText('Verificados');
    const valueEls = container.querySelectorAll('[data-value]');
    expect(valueEls).toHaveLength(4);
    expect(valueEls[0].textContent).toBe('2');  // verified
    expect(valueEls[1].textContent).toBe('1');  // missing
  });

  // B2, ronda 2 de review de spec-95 fase 6 (bloqueante) — `usePickupScans`
  // / `useMissingPackages` pausadas (`networkMode:'online'`, un enlace
  // profundo o recarga de la PWA) leen `data: undefined`; el `= []` que
  // tenía la página convertía eso en "0 verificados, 0 faltantes" dentro
  // del aviso que TRANSFIERE CUSTODIA. Mismo patrón que
  // `review/[loadId]/page.tsx:199-204` ya aplica: gatear por presencia de
  // dato, no por `isLoading`/`isError`.
  it('B2 — shows a loading state instead of "0 verificados / 0 faltantes" when scans or missingPackages are still undefined (a paused query, not an empty one)', async () => {
    mockUsePickupScans.mockReturnValue({ data: undefined });
    render(<CompletionPage />);
    await waitFor(() => {
      expect(screen.queryByText('Aviso de transferencia de custodia')).not.toBeInTheDocument();
    });
    expect(screen.queryByText(/0 paquetes verificados/)).not.toBeInTheDocument();
  });

  it('B2 — same gate applies when missingPackages alone is undefined', async () => {
    mockUseMissingPackages.mockReturnValue({ data: undefined });
    render(<CompletionPage />);
    await waitFor(() => {
      expect(screen.queryByText('Aviso de transferencia de custodia')).not.toBeInTheDocument();
    });
  });

  // Ronda 2 de review del PR #726 (B2) — asimétrico a propósito: dos filas
  // 'verified' que comparten package_id (dos miembros de la cuadrilla, sin
  // señal, escaneando el mismo bulto — dos client_operation_id distintos,
  // el único índice único del repo no los frena) deben contar como UN
  // paquete verificado, no dos. Con un conteo de filas este test falla en 2.
  it('B2 — dedupes verified scans by package_id, matching close_manifest\'s own COUNT(DISTINCT)', async () => {
    mockUsePickupScans.mockReturnValue({
      data: [
        { id: 's1', scan_result: 'verified', package_id: 'pkg-shared' },
        { id: 's2', scan_result: 'verified', package_id: 'pkg-shared' },
        { id: 's3', scan_result: 'verified', package_id: 'pkg-other' },
      ],
    });

    const { container } = render(<CompletionPage />);
    await screen.findByText('Verificados');

    const valueEls = container.querySelectorAll('[data-value]');
    expect(valueEls[0].textContent).toBe('2');
  });

  // Seguimiento del PR #726 (ronda 3) — SQL's COUNT(DISTINCT) drops NULLs;
  // a JS Set counts `null` as a member. Not reachable today (pickup_scans
  // only writes package_id on a real match), but the precedent this code
  // cites (useRouteManifests.ts) already guards it — this brings the two
  // in line rather than leaving a silent divergence for whoever copies
  // this pattern next.
  it('does not count a verified scan with a null package_id, matching COUNT(DISTINCT) dropping NULLs', async () => {
    mockUsePickupScans.mockReturnValue({
      data: [
        { id: 's1', scan_result: 'verified', package_id: 'pkg-a' },
        { id: 's2', scan_result: 'verified', package_id: null },
      ],
    });

    const { container } = render(<CompletionPage />);
    await screen.findByText('Verificados');

    const valueEls = container.querySelectorAll('[data-value]');
    expect(valueEls[0].textContent).toBe('1');
  });

  // spec-95 fase 6, mock `5f` — el copy cambia de fondo, no sólo de forma:
  // el mock cuenta las DOS mitades (verificados que pasan a custodia de
  // Aureon, faltantes que quedan a nombre del local) con las cifras reales
  // del acta — el copy anterior no distinguía las dos y hablaba de
  // "el operador", no de Aureon. Ver la discrepancia declarada en el reporte
  // de esta fase.
  it('renders the mock\'s custody-transfer copy, with the real verified/missing counts', async () => {
    render(<CompletionPage />);
    expect(await screen.findByText('Aviso de transferencia de custodia')).toBeInTheDocument();
    // scans por defecto (beforeEach): 2 verificados; missingPackages: 1
    // (singular — ver `custodyNoticeCopy`, M1 de la ronda 2 de review).
    expect(
      screen.getByText(
        'Al firmar, 2 paquetes verificados pasan a custodia de Aureon. 1 faltante queda a nombre del local hasta que se resuelva.'
      )
    ).toBeInTheDocument();
  });

  // Ronda 2 de review de spec-95 fase 6 (B3) — el test de arriba usaba
  // SIEMPRE las mismas dos cifras del `beforeEach` (2 y 1): hardcodear el
  // string entero en `page.tsx` pasaba ese test igual. Este usa cifras
  // DISTINTAS entre sí y del `beforeEach`, así que un valor quemado no
  // puede coincidir con ambos tests a la vez.
  it('B3 — the custody copy tracks DIFFERENT counts, not a fixed pair (kills the hardcoded-string mutation)', async () => {
    mockUsePickupScans.mockReturnValue({
      data: [
        { id: 's1', scan_result: 'verified', package_id: 'pkg-a' },
        { id: 's2', scan_result: 'verified', package_id: 'pkg-b' },
        { id: 's3', scan_result: 'verified', package_id: 'pkg-c' },
        { id: 's4', scan_result: 'verified', package_id: 'pkg-d' },
      ],
    });
    mockUseMissingPackages.mockReturnValue({
      data: [
        { id: 'pkg1', label: 'PKG-001' },
        { id: 'pkg2', label: 'PKG-002' },
      ],
    });

    render(<CompletionPage />);

    expect(
      await screen.findByText(
        'Al firmar, 4 paquetes verificados pasan a custodia de Aureon. 2 faltantes quedan a nombre del local hasta que se resuelvan.'
      )
    ).toBeInTheDocument();
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

  // spec-95 fase 6, mock `5f` — la casilla lleva la etiqueta "opcional" a
  // la derecha (mismo texto que ya usa `SignaturePad label="Firma del
  // cliente (opcional)"`, ahora también en la fila de la casilla).
  it('renders "opcional" next to the client-signature checkbox label', async () => {
    render(<CompletionPage />);
    expect(await screen.findByText('opcional')).toBeInTheDocument();
  });

  it('renders Spanish button text (5f CTA: "Confirmar y cerrar carga")', async () => {
    render(<CompletionPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /confirmar y cerrar carga/i })).toBeInTheDocument();
    });
  });

  // spec-95 fase 7, mock `5f2` — el diálogo irreversible pasa de
  // `AlertDialog` centrado a una hoja inferior (`CustodyConfirmationSheet`,
  // mockeado arriba con captura de props — su propio render real, con foco,
  // `role` y contenido, vive en `CustodyConfirmationSheet.test.tsx`). Este
  // grupo cubre SÓLO el cableado desde la página: qué valores le llegan.
  //
  // Ronda 2 de review (hallazgo 3, mayor) — la versión anterior de este
  // grupo comprobaba el DOM del componente real; una mutación que sustituía
  // `serverPhotosCount`/`queuedPhotosCount`/`isSubmitting` por literales fijos
  // pasaba esos 45/45 tests igual, porque nada leía esos props concretos.
  describe('5f2 — custody confirmation sheet (cableado página → hoja)', () => {
    const openSheet = async () => {
      render(<CompletionPage />);
      const sigPad = await screen.findByTestId('signature-pad-Firma del operador (obligatoria)');
      fireEvent.click(sigPad);
      fireEvent.click(await screen.findByRole('button', { name: /confirmar y cerrar carga/i }));
      await screen.findByTestId('custody-sheet-mock');
    };

    // scans por defecto (beforeEach): 2 verificados; missingPackages: 1.
    it('passes the real verified/missing counts, not zeros', async () => {
      await openSheet();
      const lastProps = mockCustodySheetProps.at(-1);
      expect(lastProps).toEqual(
        expect.objectContaining({ open: true, verifiedCount: 2, missingCount: 1 })
      );
    });

    // Mata la mutación `serverPhotosCount={0}, queuedPhotosCount={0}`: con
    // documentos confirmados y algo en cola (valores DISTINTOS de 0 y entre
    // sí), un literal fijo no puede coincidir con ambos a la vez.
    it('passes the real serverPhotosCount and queuedPhotosCount, not hardcoded zeros', async () => {
      mockUseManifestDocuments.mockReturnValue({ data: [{ id: 'd1' }, { id: 'd2' }] });
      mockUseQueuedManifestPhotoCount.mockReturnValue(3);

      await openSheet();

      const lastProps = mockCustodySheetProps.at(-1);
      expect(lastProps).toEqual(
        expect.objectContaining({ serverPhotosCount: 2, queuedPhotosCount: 3 })
      );
    });

    it('passes operatorName, and clientName=null when the client has not signed', async () => {
      await openSheet();
      const lastProps = mockCustodySheetProps.at(-1);
      expect(lastProps).toEqual(
        expect.objectContaining({ operatorName: 'Test User', clientName: null })
      );
    });

    it('passes clientName once the client actually signed', async () => {
      render(<CompletionPage />);
      const sigPad = await screen.findByTestId('signature-pad-Firma del operador (obligatoria)');
      fireEvent.click(sigPad);

      fireEvent.click(screen.getByLabelText('Agregar firma del cliente'));
      fireEvent.change(screen.getByPlaceholderText('Nombre del cliente'), {
        target: { value: 'Marcela Rojas' },
      });
      const clientSig = await screen.findByTestId('signature-pad-Firma del cliente (opcional)');
      fireEvent.click(clientSig);

      fireEvent.click(await screen.findByRole('button', { name: /confirmar y cerrar carga/i }));
      await screen.findByTestId('custody-sheet-mock');

      const lastProps = mockCustodySheetProps.at(-1);
      expect(lastProps).toEqual(expect.objectContaining({ clientName: 'Marcela Rojas' }));
    });

    // Mata la mutación de leer `clientName` sin el guard de
    // `clientSignature`: un nombre escrito en el campo sin trazo dibujado
    // NO es una firma — "Firmas" no puede afirmar que el local firmó
    // cuando sólo tecleó su nombre.
    it('keeps clientName=null when the name was typed but never signed', async () => {
      render(<CompletionPage />);
      const sigPad = await screen.findByTestId('signature-pad-Firma del operador (obligatoria)');
      fireEvent.click(sigPad);

      fireEvent.click(screen.getByLabelText('Agregar firma del cliente'));
      fireEvent.change(screen.getByPlaceholderText('Nombre del cliente'), {
        target: { value: 'Marcela Rojas' },
      });
      // Sin clic en el pad de firma del cliente — sólo el nombre, sin trazo.

      fireEvent.click(await screen.findByRole('button', { name: /confirmar y cerrar carga/i }));
      await screen.findByTestId('custody-sheet-mock');

      const lastProps = mockCustodySheetProps.at(-1);
      expect(lastProps).toEqual(expect.objectContaining({ clientName: null }));
    });

    // Mata la mutación `isSubmitting={false}`: `handleComplete` marca
    // `isSubmitting=true` de forma SÍNCRONA (antes del primer `await`), así
    // que ese render ya está confirmado en cuanto `fireEvent.click` retorna
    // — sin esperar a que el RPC (una promesa ya resuelta en el doble)
    // drene su microtarea. Este doble, a diferencia del componente real, NO
    // se cierra solo al confirmar — por eso sigue montado para poder leerlo.
    it('flips isSubmitting to true synchronously once confirm is tapped', async () => {
      await openSheet();
      mockCustodySheetProps.length = 0; // sólo interesa lo que pasa DESPUÉS del clic

      fireEvent.click(screen.getByRole('button', { name: 'Sí, cerrar la carga' }));

      expect(mockCustodySheetProps.some((p) => p.isSubmitting === true)).toBe(true);
    });

    it('"Volver a revisar" closes the sheet WITHOUT calling close_manifest', async () => {
      await openSheet();

      fireEvent.click(screen.getByRole('button', { name: 'Volver a revisar' }));

      await waitFor(() => {
        expect(screen.queryByTestId('custody-sheet-mock')).not.toBeInTheDocument();
      });
      expect(mockRpc).not.toHaveBeenCalledWith('close_manifest', expect.anything());
    });
  });

  // spec-80 fase 3 — "bloque de fotos arriba" (5f): el respaldo fotográfico
  // se monta antes de la línea de seguridad offline y de ambas firmas.
  it('renders the manifest photo strip before the offline-safety line (5f: fotos arriba)', async () => {
    render(<CompletionPage />);
    const strip = await screen.findByTestId('manifest-photo-strip');
    const line = await screen.findByText(
      'Todo queda en el teléfono y se sube al recuperar señal. Las fotos también.',
    );
    expect(strip.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // Ronda 2 de review del PR #736 (M1, bloqueante) — sin esta guardia,
  // borrar `externalLoadId={loadId}` en `page.tsx` deja los 26/26 tests de
  // esta suite en verde: el chip de sync (spec-81 fase 4) no podría decirle
  // al operario qué carga abrir para una foto `dead`, y ningún test lo
  // notaría.
  it('passes externalLoadId (the human-readable loadId) down to ManifestPhotoStrip', async () => {
    render(<CompletionPage />);
    await screen.findByTestId('manifest-photo-strip');
    expect(mockManifestPhotoStripProps.at(-1)).toEqual(
      expect.objectContaining({ externalLoadId: 'CARGA-001' })
    );
  });

  // M3, ronda 2 de review del PR #706 — el reordenado de firmas es uno de
  // los tres ítems del checklist de esta fase y no tenía ni un test:
  // volver a intercambiar los bloques (deshacer exactamente lo que esta
  // fase entrega) dejaba los demás tests en verde.
  it('renders FIRMA DEL LOCAL before TU FIRMA, matching the 5f mock order', async () => {
    render(<CompletionPage />);
    const local = await screen.findByText('FIRMA DEL LOCAL');
    const tuya = await screen.findByText('TU FIRMA');
    expect(local.compareDocumentPosition(tuya) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
      name: /confirmar y cerrar carga/i,
    });
    fireEvent.click(submitButton);

    const confirmButton = await screen.findByRole('button', {
      name: 'Sí, cerrar la carga',
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
      name: /confirmar y cerrar carga/i,
    });
    fireEvent.click(submitButton);

    const confirmButton = await screen.findByRole('button', {
      name: 'Sí, cerrar la carga',
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
  // spec-80 fase 5 (5i) — this used to navigate away to /app/pickup right
  // after the toast; it now stays on this route and shows the closed
  // summary (5i) instead. "Volver a mis recogidas", the summary's own CTA,
  // is what navigates now — to /app/pickup/route/active (5c), not
  // /app/pickup — and is asserted separately below.
  it('MANIFEST_ALREADY_SIGNED (idempotent 409) is treated as success and shows the closed summary — the close already applied', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'MANIFEST_ALREADY_SIGNED: manifest already has an operator signature' },
    });
    const { toast } = await import('sonner');

    await completeAndSubmit();

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/ya fue firmado/i));
    });
    expect(await screen.findByText('Carga cerrada')).toBeInTheDocument();
    // B1, ronda 2 de review del PR #726 — al menos un camino de la página
    // ancla las cifras reales del acta, no sólo la existencia del texto.
    // scans por defecto: 2 filas 'verified' con package_id distinto (pkg-a,
    // pkg-b) → 2; missingPackages por defecto: 1 fila → 1.
    expect(within(screen.getByTestId('summary-row-verified')).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByTestId('summary-row-missing')).getByText('1')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  // Seguimiento del PR #726 (ronda 3) — B1 sólo ancló verified/missing;
  // unexpectedCount, photosCount y signaturesCount seguían sin ninguna
  // aserción a nivel de página, así que sustituirlos por constantes en
  // `page.tsx` pasaba las 24/24 pruebas de este archivo. Valores todos
  // distintos entre sí y de cualquier default (1 ajeno, 3 fotos, 2 firmas)
  // para que una constante equivocada no pueda colar por coincidencia.
  it('anchors unexpectedCount, photosCount and signaturesCount too — not just verified/missing', async () => {
    mockUsePickupScans.mockReturnValue({
      data: [
        { id: 's1', scan_result: 'verified', package_id: 'pkg-a' },
        { id: 's2', scan_result: 'verified', package_id: 'pkg-b' },
        { id: 's3', scan_result: 'not_found', barcode_scanned: 'BC-1', scanned_at: '2026-09-09T10:00:00Z' },
      ],
    });
    mockUseManifestDocuments.mockReturnValue({
      data: [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }],
    });

    render(<CompletionPage />);
    const operatorSig = await screen.findByTestId('signature-pad-Firma del operador (obligatoria)');
    fireEvent.click(operatorSig);

    // "Agregar firma del cliente" → nombre + firma del cliente, para que
    // signaturesCount sea 2, no el 1 por defecto. Ronda 2 de review de
    // spec-95 fase 7 (hallazgo 5a) — signaturesCount ahora exige AMBOS
    // (nombre y trazo), no sólo el trazo.
    fireEvent.click(screen.getByLabelText('Agregar firma del cliente'));
    fireEvent.change(screen.getByPlaceholderText('Nombre del cliente'), {
      target: { value: 'Marcela Rojas' },
    });
    const clientSig = await screen.findByTestId('signature-pad-Firma del cliente (opcional)');
    fireEvent.click(clientSig);

    fireEvent.click(screen.getByRole('button', { name: /confirmar y cerrar carga/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, cerrar la carga' }));

    await screen.findByText('Carga cerrada');
    expect(within(screen.getByTestId('summary-row-unexpected')).getByText('1')).toBeInTheDocument();
    expect(within(screen.getByTestId('summary-row-backup')).getByText('3 fotos · 2 firmas')).toBeInTheDocument();
  });

  // Ronda 4 de review del PR #736 (bloqueante 2) — antes de esta ronda,
  // `photosCount` era sólo `documents.length`: una foto recién capturada
  // (encolada pero todavía sin confirmar por el servidor) no sumaba nada al
  // "Respaldo" de `5i`. `documents.length` fijo en 3 aquí (ver el test de
  // arriba) — si el merge se rompiera y `photosCount` volviera a leer sólo
  // `documents.length`, este test seguiría viendo "3 fotos", no "5 fotos".
  // Ronda 2 de review de spec-95 fase 7 (hallazgo 5a) — un trazo de firma
  // SIN nombre no debe contarse como un segundo firmante en `5i`, o esta
  // pantalla contradice a `5f2` (que, con el mismo dato, NO nombra a nadie
  // bajo "Firmas" — ver `CustodyConfirmationSheet.test.tsx`).
  it('does not count an unnamed client signature as a second "firma" in 5i, matching 5f2', async () => {
    render(<CompletionPage />);
    const sigPad = await screen.findByTestId('signature-pad-Firma del operador (obligatoria)');
    fireEvent.click(sigPad);

    fireEvent.click(screen.getByLabelText('Agregar firma del cliente'));
    const clientSig = await screen.findByTestId('signature-pad-Firma del cliente (opcional)');
    fireEvent.click(clientSig);
    // Sin nombre tecleado.

    fireEvent.click(screen.getByRole('button', { name: /confirmar y cerrar carga/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, cerrar la carga' }));

    await screen.findByText('Carga cerrada');
    expect(
      within(screen.getByTestId('summary-row-backup')).getByText(/· 1 firmas$/)
    ).toBeInTheDocument();
  });

  it('adds queuedPhotoCount to documents.length in "Respaldo" — server-confirmed plus not-yet-confirmed', async () => {
    mockUseManifestDocuments.mockReturnValue({
      data: [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }],
    });
    mockUseQueuedManifestPhotoCount.mockReturnValue(2);

    await completeAndSubmit();

    await screen.findByText('Carga cerrada');
    expect(
      within(screen.getByTestId('summary-row-backup')).getByText('5 fotos · 1 firmas')
    ).toBeInTheDocument();
  });

  // Seguimiento de spec-80 fase 6 (PR #736) — este page.tsx pasaba
  // `documents.length` a `ManifestClosedSummary` con un `= []` en la
  // desestructuración: el MISMO `undefined` que la ronda 4 ya corrigió en
  // `ManifestPhotoStrip` (`manifest-photo-count`) seguía convirtiéndose en
  // "0 fotos" aquí — en la pantalla de carga cerrada, con hojas ya
  // confirmadas por el servidor. `useManifestDocuments` queda en pausa
  // (`networkMode:'online'`) devolviendo `data: undefined` en el mismo
  // escenario que la ronda 4 documentó: un 500/RLS transitorio al montar.
  it('does not turn an unreadable server photo count into "0 fotos" — shows the dash instead', async () => {
    mockUseManifestDocuments.mockReturnValue({ data: undefined });
    mockUseQueuedManifestPhotoCount.mockReturnValue(0);

    await completeAndSubmit();

    await screen.findByText('Carga cerrada');
    expect(
      within(screen.getByTestId('summary-row-backup')).getByText('— · 1 firmas')
    ).toBeInTheDocument();
  });

  it('still shows the queued count when the server is unreadable, instead of a bare dash', async () => {
    mockUseManifestDocuments.mockReturnValue({ data: undefined });
    mockUseQueuedManifestPhotoCount.mockReturnValue(2);

    await completeAndSubmit();

    await screen.findByText('Carga cerrada');
    expect(
      within(screen.getByTestId('summary-row-backup')).getByText(
        '2 en cola (resto desconocido) · 1 firmas'
      )
    ).toBeInTheDocument();
  });

  // Ronda 2 de review del PR #743 (moderado 1) — un mock que descarta los
  // argumentos no detecta pasar `loadId` (el código externo, `CARGA-99814`)
  // donde va `manifestId` (el UUID). `queuedManifestPhotoCount` filtra por
  // `entry.manifestId === manifestId`: con el id equivocado no casa NINGUNA
  // fila jamás, así que el bug se ve exactamente igual que "cola vacía" —
  // "3 fotos" en vez de "5", o `—` en vez de "2 en cola, resto desconocido"
  // con el servidor ilegible. El mismo agujero que la ronda 2 de #736 ya
  // había encontrado en `ManifestPhotoStrip` (de ahí
  // `mockManifestPhotoStripProps`, `:10-15`), sin cerrar en esta costura.
  it('calls useManifestDocuments and useQueuedManifestPhotoCount with (operatorId, manifestId) — not loadId', async () => {
    render(<CompletionPage />);
    await screen.findByTestId('manifest-photo-strip');

    expect(mockUseManifestDocuments).toHaveBeenCalledWith('op-1', 'm1');
    expect(mockUseQueuedManifestPhotoCount).toHaveBeenCalledWith('op-1', 'm1');
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
          // Ronda 3 de review del PR #725 (M mayor, spec-81 fase 4) — el
          // chip de sync necesita el id navegable, no el UUID interno.
          externalLoadId: 'CARGA-001',
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
    // spec-80 fase 5 (5i) — queuing offline also shows the closed summary
    // in place, rather than navigating away immediately.
    expect(await screen.findByText('Carga cerrada')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
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
        screen.getByRole('button', { name: /confirmar y cerrar carga/i }),
      ).not.toBeDisabled();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  // spec-80 fase 5 (5i) — "Vuelve a 5c (/app/pickup/route/active), no a
  // /app/pickup como hoy".
  it('the closed summary\'s "Volver a mis recogidas" navigates to the active route, not /app/pickup', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    await completeAndSubmit();

    const backButton = await screen.findByRole('button', { name: 'Volver a mis recogidas' });
    await user.click(backButton);

    expect(mockPush).toHaveBeenCalledWith('/app/pickup/route/active');
    expect(mockPush).not.toHaveBeenCalledWith('/app/pickup');
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
