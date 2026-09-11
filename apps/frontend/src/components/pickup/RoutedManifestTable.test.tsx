import type { ReactElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RoutedManifestTable } from './RoutedManifestTable';
import type { RoutedManifest } from '@/hooks/pickup/useRoutedManifests';

const operatorIdMock = vi.fn(() => ({ operatorId: 'op-1' }));
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => operatorIdMock(),
}));

const removeMutate = vi.fn();
vi.mock('@/hooks/pickup/useRemoveManifestFromRoute', () => ({
  useRemoveManifestFromRoute: () => ({ mutate: removeMutate, isPending: false }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const NOW = new Date('2026-09-10T12:00:00Z');

// Round 2 de review (fase 3) — el componente ahora llama useQueryClient()
// directamente (para invalidar tras las dos guardas del RPC que se
// traducen en el onError), así que cada render necesita un QueryClient
// real de verdad, igual que route/active/page.test.tsx.
function renderTable(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>), qc };
}

function makeRow(overrides: Partial<RoutedManifest> = {}): RoutedManifest {
  return {
    id: 'm1',
    external_load_id: 'CARGA-94-DOCK',
    retailer_name: 'Easy',
    total_orders: 5,
    total_packages: 12,
    created_at: '2026-09-10T08:00:00Z',
    pickup_point: 'Easy Vespucio',
    labels_printed_at: null,
    labels_printed_by_name: null,
    route_code: 'PR-2026-0042',
    route_started_at: '2026-09-10T10:00:00Z',
    driver_name: 'Juan Pérez',
    route_status: 'in_progress',
    closed_at: null,
    missing_count: 0,
    verified_count: 3,
    pickup_route_id: 'route-1',
    ...overrides,
  };
}

describe('RoutedManifestTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    operatorIdMock.mockReturnValue({ operatorId: 'op-1' });
  });

  it('shows the empty message when there are no rows', () => {
    renderTable(<RoutedManifestTable rows={[]} emptyMessage="Ninguna carga en ruta." now={NOW} />);
    expect(screen.getByText('Ninguna carga en ruta.')).toBeInTheDocument();
  });

  it('renders the load, route, driver and package count', () => {
    renderTable(<RoutedManifestTable rows={[makeRow()]} emptyMessage="—" now={NOW} />);
    expect(screen.getByText('CARGA-94-DOCK')).toBeInTheDocument();
    expect(screen.getByText('PR-2026-0042')).toBeInTheDocument();
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('shows "abierta hace" as elapsed time since route_started_at', () => {
    renderTable(<RoutedManifestTable rows={[makeRow()]} emptyMessage="—" now={NOW} />);
    // route_started_at 10:00, now 12:00 -> 2h 0m.
    expect(screen.getByText('2h 0m')).toBeInTheDocument();
  });

  it('shows no closed chip while the load is still being scanned', () => {
    renderTable(<RoutedManifestTable rows={[makeRow({ closed_at: null })]} emptyMessage="—" now={NOW} />);
    expect(screen.queryByTestId('closed-chip')).not.toBeInTheDocument();
  });

  it('shows a success-toned chip on a clean close', () => {
    renderTable(
      <RoutedManifestTable
        rows={[makeRow({ closed_at: '2026-09-10T09:00:00Z', missing_count: 0 })]}
        emptyMessage="—"
        now={NOW}
      />,
    );
    const chip = screen.getByTestId('closed-chip');
    // Time-of-day text is locale/TZ-dependent in this test environment
    // (matches the repo's existing convention — TodayClosuresPanel.test.tsx
    // does not assert the literal HH:MM either); assert the "cerrada"
    // prefix and the tone, not the exact clock text.
    expect(chip).toHaveTextContent(/^cerrada/);
    expect(chip.className).toContain('status-success');
  });

  it('shows a warning-toned chip with the missing count on a close with discrepancies', () => {
    renderTable(
      <RoutedManifestTable
        rows={[makeRow({ closed_at: '2026-09-10T09:00:00Z', missing_count: 3 })]}
        emptyMessage="—"
        now={NOW}
      />,
    );
    const chip = screen.getByTestId('closed-chip');
    expect(chip).toHaveTextContent(/^cerrada/);
    expect(chip).toHaveTextContent('3 faltantes');
    expect(chip.className).toContain('status-warning');
  });

  // ronda 4 (review fase 2) — the row also carries "—" in other cells
  // (empty-message fallback shape, closed-chip absence), so asserting on
  // the whole row would pass even if the driver cell rendered something
  // else entirely. Assert on the driver cell specifically.
  it('renders a placeholder for a route with no resolvable driver', () => {
    renderTable(<RoutedManifestTable rows={[makeRow({ driver_name: null })]} emptyMessage="—" now={NOW} />);
    expect(screen.getByTestId('driver-name')).toHaveTextContent('—');
  });

  // Ronda 2 de review — el rótulo original ("Ver ruta") prometía una
  // pantalla de detalle de ruta que no existe; el destino real es la
  // pantalla de QR de entrega al hub ("Entrega en bodega — Muestra este QR
  // al receptor", RouteQRView.tsx). El rótulo dice lo que la pantalla
  // hace, no lo que un supervisor esperaría que hiciera.
  it('renders a "QR de entrega" link that points at the route by its id', () => {
    renderTable(<RoutedManifestTable rows={[makeRow({ pickup_route_id: 'route-99' })]} emptyMessage="—" now={NOW} />);
    const link = screen.getByRole('link', { name: 'QR de entrega' });
    expect(link).toHaveAttribute('href', '/app/pickup/route/route-99/qr');
  });

  // spec-94 fase 3 — "Quitar de la ruta" reutiliza useRemoveManifestFromRoute
  // (mockeado arriba). Cada condición de abajo se prueba en su propio test,
  // afirmando la razón CONCRETA que muestra la fila -- no sólo "está
  // deshabilitado" (ese patrón ya se coló tres veces en este spec y pasa en
  // verde aunque la razón sea la equivocada).
  describe('"Quitar de la ruta"', () => {
    it('is enabled when the load is still open, unverified, and the route is in_progress', () => {
      renderTable(
        <RoutedManifestTable
          rows={[makeRow({ verified_count: 0, closed_at: null, route_status: 'in_progress' })]}
          emptyMessage="—"
          now={NOW}
        />,
      );
      const button = screen.getByRole('button', { name: 'Quitar de la ruta' });
      expect(button).toBeEnabled();
      expect(screen.queryByTestId('remove-disabled-reason')).not.toBeInTheDocument();
    });

    it('calls useRemoveManifestFromRoute with the route id and manifest id when clicked', async () => {
      const user = userEvent.setup();
      renderTable(
        <RoutedManifestTable
          rows={[makeRow({ id: 'm-42', pickup_route_id: 'route-42', verified_count: 0, closed_at: null, route_status: 'in_progress' })]}
          emptyMessage="—"
          now={NOW}
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Quitar de la ruta' }));
      expect(removeMutate).toHaveBeenCalledWith(
        { routeId: 'route-42', manifestId: 'm-42' },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
          onSettled: expect.any(Function),
        }),
      );
    });

    // Nit de review (ronda 2) — mismo patrón que route/active/page.tsx:291-295
    // documenta a propósito: no llamar mutate() con un operatorId nulo
    // (invalidaría queries que no matchean nada). Se prueba forzando
    // useOperatorId() a devolver null.
    it('does not call the mutation when operatorId has not resolved yet', async () => {
      operatorIdMock.mockReturnValue({ operatorId: null });
      const user = userEvent.setup();
      renderTable(
        <RoutedManifestTable
          rows={[makeRow({ verified_count: 0, closed_at: null, route_status: 'in_progress' })]}
          emptyMessage="—"
          now={NOW}
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Quitar de la ruta' }));
      expect(removeMutate).not.toHaveBeenCalled();
    });

    // Guarda 7 del RPC (spec-64) -- pero dicha por delante en la fila, no
    // descubierta como un toast.
    it('disables removal and shows the verified-count reason once any package is verified', () => {
      renderTable(
        <RoutedManifestTable
          rows={[makeRow({ verified_count: 2, closed_at: null, route_status: 'in_progress' })]}
          emptyMessage="—"
          now={NOW}
        />,
      );
      const button = screen.getByRole('button', { name: 'Quitar de la ruta' });
      expect(button).toBeDisabled();
      expect(screen.getByTestId('remove-disabled-reason')).toHaveTextContent(
        'ya tiene 2 bultos verificados; debe cerrarse desde la ruta',
      );
    });

    // El que más importa: ninguna guarda del RPC lo cubre. Una carga cerrada
    // por la vía de todo-discrepancias tiene CERO escaneos verified, así que
    // sin este chequeo el botón quedaría habilitado y el UPDATE borraría la
    // firma del cliente.
    it('disables removal and shows the signature reason for a completed load, even with zero verified scans', () => {
      renderTable(
        <RoutedManifestTable
          rows={[
            makeRow({
              verified_count: 0,
              closed_at: '2026-09-10T09:00:00Z',
              route_status: 'in_progress',
            }),
          ]}
          emptyMessage="—"
          now={NOW}
        />,
      );
      const button = screen.getByRole('button', { name: 'Quitar de la ruta' });
      expect(button).toBeDisabled();
      expect(screen.getByTestId('remove-disabled-reason')).toHaveTextContent(
        'la carga ya está cerrada y firmada: quitarla borraría la firma',
      );
    });

    it('disables removal and shows the route-state reason once the route is no longer in_progress', () => {
      renderTable(
        <RoutedManifestTable
          rows={[makeRow({ verified_count: 0, closed_at: null, route_status: 'draft' })]}
          emptyMessage="—"
          now={NOW}
        />,
      );
      const button = screen.getByRole('button', { name: 'Quitar de la ruta' });
      expect(button).toBeDisabled();
      expect(screen.getByTestId('remove-disabled-reason')).toHaveTextContent(
        'la ruta ya no admite cambios',
      );
    });

    // route_status IS NULL es la otra mitad de la guarda 2/3 del RPC -- la
    // RPC en sí nunca lo emite en la práctica (ver el docstring de
    // RoutedManifest), pero el chequeo del componente es defensivo, así que
    // se prueba igual.
    it('disables removal and shows the route-state reason when route_status is null', () => {
      const row = makeRow({ verified_count: 0, closed_at: null }) as RoutedManifest & {
        route_status: string | null;
      };
      row.route_status = null;
      renderTable(<RoutedManifestTable rows={[row as RoutedManifest]} emptyMessage="—" now={NOW} />);
      const button = screen.getByRole('button', { name: 'Quitar de la ruta' });
      expect(button).toBeDisabled();
      expect(screen.getByTestId('remove-disabled-reason')).toHaveTextContent(
        'la ruta ya no admite cambios',
      );
    });

    // Precedencia, dicha explícitamente: con las tres condiciones activas a
    // la vez, gana la razón de "cerrada y firmada" -- es la más severa (una
    // carga completada no se toca, sea cual sea su verified_count o el
    // estado de la ruta) y la única que el usuario necesita leer primero.
    it('shows the signature reason first when all three conditions are true at once', () => {
      renderTable(
        <RoutedManifestTable
          rows={[
            makeRow({
              verified_count: 5,
              closed_at: '2026-09-10T09:00:00Z',
              route_status: 'draft',
            }),
          ]}
          emptyMessage="—"
          now={NOW}
        />,
      );
      const button = screen.getByRole('button', { name: 'Quitar de la ruta' });
      expect(button).toBeDisabled();
      expect(screen.getByTestId('remove-disabled-reason')).toHaveTextContent(
        'la carga ya está cerrada y firmada: quitarla borraría la firma',
      );
    });

    // Ronda 2 de review — hallazgo real: el test de arriba sólo prueba la
    // mitad de la precedencia (closed_at contra las otras dos). Esta cubre
    // la otra mitad: verified_count contra route_status, con closed_at en
    // NULL. Invirtiendo el orden de esos dos checks en el componente, este
    // test (y sólo éste) cae -- el de arriba sigue en verde porque closed_at
    // sigue ganando primero.
    it('shows the verified-count reason over the route-state reason when both are true and the load is not yet closed', () => {
      renderTable(
        <RoutedManifestTable
          rows={[
            makeRow({
              verified_count: 3,
              closed_at: null,
              route_status: 'draft',
            }),
          ]}
          emptyMessage="—"
          now={NOW}
        />,
      );
      const button = screen.getByRole('button', { name: 'Quitar de la ruta' });
      expect(button).toBeDisabled();
      expect(screen.getByTestId('remove-disabled-reason')).toHaveTextContent(
        'ya tiene 3 bultos verificados; debe cerrarse desde la ruta',
      );
    });

    // Ronda 2 de review — antes, `removeMut.isPending` (un único booleano
    // por tabla) deshabilitaba las DOS filas a la vez apenas una mutación
    // estaba en curso. El mock de mutate no invoca ningún callback (simula
    // "todavía en vuelo"), así que si el componente volviera a compartir un
    // solo isPending, este test fallaría con la fila B también deshabilitada.
    it('only disables the row being removed, not every row in the table', async () => {
      const user = userEvent.setup();
      renderTable(
        <RoutedManifestTable
          rows={[
            makeRow({ id: 'row-a', pickup_route_id: 'route-a', verified_count: 0, closed_at: null, route_status: 'in_progress' }),
            makeRow({
              id: 'row-b',
              external_load_id: 'CARGA-94-OTHER',
              pickup_route_id: 'route-b',
              verified_count: 0,
              closed_at: null,
              route_status: 'in_progress',
            }),
          ]}
          emptyMessage="—"
          now={NOW}
        />,
      );
      const buttons = screen.getAllByRole('button', { name: 'Quitar de la ruta' });
      expect(buttons).toHaveLength(2);
      await user.click(buttons[0]);
      expect(buttons[0]).toBeDisabled();
      expect(buttons[1]).toBeEnabled();
    });

    // Ronda 2 de review, decisión B — guardas 3 y 7 del RPC llegan en
    // inglés crudo con UUID ('pickup route ... is not in_progress
    // (status=...)', 'manifest ... has verified scans and cannot be
    // removed'); bajo staleTime=30s son alcanzables desde esta pantalla
    // (la fila puede ir un minuto por detrás de la ruta real). Se mapean a
    // español en el onError, SIN tocar el mensaje del RPC, y se invalida
    // la query para que la fila se ponga al día.
    it('translates a stale route-status RPC error to Spanish and refetches the row', async () => {
      let capturedOnError: ((err: Error) => void) | undefined;
      removeMutate.mockImplementation((_args, opts) => {
        capturedOnError = opts.onError;
      });
      const { qc } = renderTable(
        <RoutedManifestTable
          rows={[makeRow({ verified_count: 0, closed_at: null, route_status: 'in_progress' })]}
          emptyMessage="—"
          now={NOW}
        />,
      );
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Quitar de la ruta' }));

      const { toast } = await import('sonner');
      capturedOnError?.(
        new Error('pickup route 9f3c1111-2222-3333-4444-555566667777 is not in_progress (status=in_transit)'),
      );

      expect(toast.error).toHaveBeenCalledWith(
        expect.stringMatching(/ruta ya no admite cambios|ya no está en curso/i),
      );
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['pickup', 'manifests'] }),
      );
    });

    it('translates a stale verified-scans RPC error to Spanish and refetches the row', async () => {
      let capturedOnError: ((err: Error) => void) | undefined;
      removeMutate.mockImplementation((_args, opts) => {
        capturedOnError = opts.onError;
      });
      const { qc } = renderTable(
        <RoutedManifestTable
          rows={[makeRow({ verified_count: 0, closed_at: null, route_status: 'in_progress' })]}
          emptyMessage="—"
          now={NOW}
        />,
      );
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Quitar de la ruta' }));

      const { toast } = await import('sonner');
      capturedOnError?.(
        new Error('manifest 8ab21111-2222-3333-4444-555566667777 has verified scans and cannot be removed'),
      );

      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/bultos verificados/i));
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['pickup', 'manifests'] }),
      );
    });

    // Un error que NO es ninguna de las dos guardas traducidas pasa tal
    // cual -- no se reescribe todo error a español (el spec sólo pide
    // traducir 3 y 7), y no se invalida nada porque no hay evidencia de que
    // la fila esté desactualizada.
    it('passes through an untranslated RPC error unchanged and does not refetch', async () => {
      let capturedOnError: ((err: Error) => void) | undefined;
      removeMutate.mockImplementation((_args, opts) => {
        capturedOnError = opts.onError;
      });
      const { qc } = renderTable(
        <RoutedManifestTable
          rows={[makeRow({ verified_count: 0, closed_at: null, route_status: 'in_progress' })]}
          emptyMessage="—"
          now={NOW}
        />,
      );
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Quitar de la ruta' }));

      const { toast } = await import('sonner');
      capturedOnError?.(new Error('Esta carga ya no está en la ruta.'));

      expect(toast.error).toHaveBeenCalledWith('Esta carga ya no está en la ruta.');
      expect(invalidateSpy).not.toHaveBeenCalled();
    });
  });
});
