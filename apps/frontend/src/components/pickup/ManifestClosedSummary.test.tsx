import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ManifestClosedSummary } from './ManifestClosedSummary';

/**
 * spec-80 fase 5, mock `5i` — "Móvil · carga cerrada, cierre del proceso
 * (vuelve a 5c)".
 *
 * Ronda 2 de review del PR #726 (B1) — asimétrico: verifiedCount=39,
 * missingCount=3, unexpectedCount=1, no todos iguales ni intercambiables
 * en pares, y cada aserción de cifra usa `within(row)` anclado por
 * `data-testid`, no `getByText` global — un `getByText('3')` global no
 * distingue "Faltantes: 3" de "Ajenos a la carga: 3" si alguna vez
 * coinciden, y con valores distintos como aquí, no distingue los
 * bindings invertidos de los correctos (`getByText` simplemente
 * encuentra el nodo con ese texto en cualquier fila).
 */
const baseProps = {
  loadId: 'CARGA-99814',
  retailerName: 'Falabella',
  verifiedCount: 39,
  missingCount: 3,
  unexpectedCount: 1,
  serverPhotosCount: 2 as number | null,
  queuedPhotosCount: 0,
  signaturesCount: 2,
  routeExternalId: null as string | null,
  pendingRouteCount: 0,
  nextManifestLabel: null as string | null,
  onBackToRoute: vi.fn(),
};

describe('ManifestClosedSummary', () => {
  it('renders the closed header with the load id and retailer', () => {
    render(<ManifestClosedSummary {...baseProps} />);
    expect(screen.getByText('Carga cerrada')).toBeInTheDocument();
    expect(screen.getByText('CARGA-99814 · Falabella')).toBeInTheDocument();
  });

  it('renders each summary row anchored to its own label — B1, ronda 2 de review del PR #726', () => {
    render(<ManifestClosedSummary {...baseProps} />);

    const verified = screen.getByTestId('summary-row-verified');
    expect(within(verified).getByText('Verificados')).toBeInTheDocument();
    expect(within(verified).getByText('39')).toBeInTheDocument();

    const missing = screen.getByTestId('summary-row-missing');
    expect(within(missing).getByText('Faltantes')).toBeInTheDocument();
    expect(within(missing).getByText('3')).toBeInTheDocument();

    const unexpected = screen.getByTestId('summary-row-unexpected');
    expect(within(unexpected).getByText('Ajenos a la carga')).toBeInTheDocument();
    expect(within(unexpected).getByText('1')).toBeInTheDocument();

    const backup = screen.getByTestId('summary-row-backup');
    expect(within(backup).getByText('Respaldo')).toBeInTheDocument();
    expect(within(backup).getByText('2 fotos · 2 firmas')).toBeInTheDocument();
  });

  it('omits the load id · retailer separator when the retailer is unknown', () => {
    render(<ManifestClosedSummary {...baseProps} retailerName={null} />);
    expect(screen.getByText('CARGA-99814')).toBeInTheDocument();
    expect(screen.queryByText(/·/)).not.toHaveTextContent('CARGA-99814 ·');
  });

  it('shows the "sigue en la ruta" block only when there is a pending load ahead', () => {
    const { rerender } = render(
      <ManifestClosedSummary
        {...baseProps}
        routeExternalId="PR-2026-0148"
        pendingRouteCount={3}
        nextManifestLabel="Parque Arauco"
      />,
    );
    expect(screen.getByText('Sigue en PR-2026-0148')).toBeInTheDocument();
    expect(
      screen.getByText('3 cargas pendientes · Parque Arauco es la próxima'),
    ).toBeInTheDocument();

    rerender(
      <ManifestClosedSummary
        {...baseProps}
        routeExternalId="PR-2026-0148"
        pendingRouteCount={0}
        nextManifestLabel={null}
      />,
    );
    expect(screen.queryByText(/^Sigue en/)).toBeNull();
  });

  it('omits the "es la próxima" half when the next manifest has no retailer name yet', () => {
    render(
      <ManifestClosedSummary
        {...baseProps}
        routeExternalId="PR-2026-0148"
        pendingRouteCount={2}
        nextManifestLabel={null}
      />,
    );
    expect(screen.getByText('2 cargas pendientes')).toBeInTheDocument();
  });

  // Seguimiento de spec-80 fase 6 (PR #736) — el mismo `undefined` de
  // `useManifestDocuments` que la ronda 4 ya corrigió en
  // `ManifestPhotoStrip` (`manifest-photo-count`) seguía mintiendo aquí, en
  // el otro consumidor de la misma query: `serverPhotosCount: number`
  // (antes `photosCount`) no podía expresar "no lo sé" y un `= []` en el
  // caller lo convertía en "0 fotos" — ver `backupPhotosLabel`
  // (`lib/pickup/manifestCloseSummary.ts`) para el porqué de cada rama.
  it('shows a dash, not "0 fotos", when the server photo count is unknown and nothing is queued', () => {
    render(<ManifestClosedSummary {...baseProps} serverPhotosCount={null} queuedPhotosCount={0} />);

    const backup = screen.getByTestId('summary-row-backup');
    expect(within(backup).getByText('— · 2 firmas')).toBeInTheDocument();
  });

  it('states what it knows — the queued count — when the server is unreadable but the queue is not empty', () => {
    render(<ManifestClosedSummary {...baseProps} serverPhotosCount={null} queuedPhotosCount={2} />);

    const backup = screen.getByTestId('summary-row-backup');
    expect(
      within(backup).getByText('2 en cola (resto desconocido) · 2 firmas'),
    ).toBeInTheDocument();
  });

  it('the primary CTA calls onBackToRoute', async () => {
    const user = userEvent.setup();
    const onBackToRoute = vi.fn();
    render(<ManifestClosedSummary {...baseProps} onBackToRoute={onBackToRoute} />);

    await user.click(screen.getByRole('button', { name: 'Volver a mis recogidas' }));

    expect(onBackToRoute).toHaveBeenCalledOnce();
  });

  // B4, ronda 2 de review del PR #726 — el mock dibuja este elemento como un
  // `<span>`, no como un control. Sin destino real en el código, un botón
  // aquí es indistinguible de uno vivo que no hace nada al pulsarlo, en la
  // pantalla que cierra un traspaso de custodia.
  it('B4 — "Ver resumen de la carga" is not a button, matching the mock\'s <span>', () => {
    render(<ManifestClosedSummary {...baseProps} />);

    expect(screen.getByText('Ver resumen de la carga')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver resumen de la carga' })).toBeNull();
  });

  // Hotfix móvil 2026-09-11 — mismo bug que #772. Este componente se
  // devuelve directo desde complete/[loadId]/page.tsx (sin envoltura
  // propia), así que su wrapper es hijo directo de `<main class="flex
  // min-h-0 flex-1 flex-col">` (AppLayout). Sin `w-full`, `mx-auto` en un
  // item flex deja de estirarse y `max-w-2xl` fija el ancho intrínseco.
  it('el wrapper lleva w-full', () => {
    render(<ManifestClosedSummary {...baseProps} />);
    const wrapper = screen.getByTestId('manifest-closed-summary');
    expect(wrapper.className).toContain('max-w-2xl');
    expect(wrapper.className).toContain('w-full');
  });
});
