import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  });

  it('shows the empty message when there are no rows', () => {
    render(<RoutedManifestTable rows={[]} emptyMessage="Ninguna carga en ruta." now={NOW} />);
    expect(screen.getByText('Ninguna carga en ruta.')).toBeInTheDocument();
  });

  it('renders the load, route, driver and package count', () => {
    render(<RoutedManifestTable rows={[makeRow()]} emptyMessage="—" now={NOW} />);
    expect(screen.getByText('CARGA-94-DOCK')).toBeInTheDocument();
    expect(screen.getByText('PR-2026-0042')).toBeInTheDocument();
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('shows "abierta hace" as elapsed time since route_started_at', () => {
    render(<RoutedManifestTable rows={[makeRow()]} emptyMessage="—" now={NOW} />);
    // route_started_at 10:00, now 12:00 -> 2h 0m.
    expect(screen.getByText('2h 0m')).toBeInTheDocument();
  });

  it('shows no closed chip while the load is still being scanned', () => {
    render(<RoutedManifestTable rows={[makeRow({ closed_at: null })]} emptyMessage="—" now={NOW} />);
    expect(screen.queryByTestId('closed-chip')).not.toBeInTheDocument();
  });

  it('shows a success-toned chip on a clean close', () => {
    render(
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
    render(
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
    render(<RoutedManifestTable rows={[makeRow({ driver_name: null })]} emptyMessage="—" now={NOW} />);
    expect(screen.getByTestId('driver-name')).toHaveTextContent('—');
  });

  it('renders a "Ver ruta" link that points at the route by its id', () => {
    render(<RoutedManifestTable rows={[makeRow({ pickup_route_id: 'route-99' })]} emptyMessage="—" now={NOW} />);
    const link = screen.getByRole('link', { name: 'Ver ruta' });
    expect(link).toHaveAttribute('href', '/app/pickup/route/route-99/qr');
  });

  // spec-94 fase 3 — "Quitar de la ruta" reutiliza useRemoveManifestFromRoute
  // (mockeado arriba). Cada condición de abajo se prueba en su propio test,
  // afirmando la razón CONCRETA que muestra la fila -- no sólo "está
  // deshabilitado" (ese patrón ya se coló tres veces en este spec y pasa en
  // verde aunque la razón sea la equivocada).
  describe('"Quitar de la ruta"', () => {
    it('is enabled when the load is still open, unverified, and the route is in_progress', () => {
      render(
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
      render(
        <RoutedManifestTable
          rows={[makeRow({ id: 'm-42', pickup_route_id: 'route-42', verified_count: 0, closed_at: null, route_status: 'in_progress' })]}
          emptyMessage="—"
          now={NOW}
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Quitar de la ruta' }));
      expect(removeMutate).toHaveBeenCalledWith(
        { routeId: 'route-42', manifestId: 'm-42' },
        expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
      );
    });

    // Guarda 7 del RPC (spec-64) -- pero dicha por delante en la fila, no
    // descubierta como un toast.
    it('disables removal and shows the verified-count reason once any package is verified', () => {
      render(
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
      render(
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
      render(
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
      render(<RoutedManifestTable rows={[row as RoutedManifest]} emptyMessage="—" now={NOW} />);
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
      render(
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
  });
});
