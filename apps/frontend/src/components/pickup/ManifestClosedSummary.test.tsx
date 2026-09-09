import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ManifestClosedSummary } from './ManifestClosedSummary';

/**
 * spec-80 fase 5, mock `5i` — "Móvil · carga cerrada, cierre del proceso
 * (vuelve a 5c)".
 */
const baseProps = {
  loadId: 'CARGA-99814',
  retailerName: 'Falabella',
  verifiedCount: 39,
  missingCount: 3,
  unexpectedCount: 1,
  photosCount: 2,
  signaturesCount: 2,
  pendingSync: null as { records: number; photos: number } | null,
  routeExternalId: null as string | null,
  pendingRouteCount: 0,
  nextManifestLabel: null as string | null,
  onBackToRoute: vi.fn(),
  onViewSummary: vi.fn(),
};

describe('ManifestClosedSummary', () => {
  it('renders the closed header with the load id and retailer', () => {
    render(<ManifestClosedSummary {...baseProps} />);
    expect(screen.getByText('Carga cerrada')).toBeInTheDocument();
    expect(screen.getByText('CARGA-99814 · Falabella')).toBeInTheDocument();
  });

  it('renders the four summary rows literal to the mock', () => {
    render(<ManifestClosedSummary {...baseProps} />);
    expect(screen.getByText('Verificados')).toBeInTheDocument();
    expect(screen.getByText('39')).toBeInTheDocument();
    expect(screen.getByText('Faltantes')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Ajenos a la carga')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Respaldo')).toBeInTheDocument();
    expect(screen.getByText('2 fotos · 2 firmas')).toBeInTheDocument();
  });

  it('omits the load id · retailer separator when the retailer is unknown', () => {
    render(<ManifestClosedSummary {...baseProps} retailerName={null} />);
    expect(screen.getByText('CARGA-99814')).toBeInTheDocument();
    expect(screen.queryByText(/·/)).not.toHaveTextContent('CARGA-99814 ·');
  });

  it('shows the "guardado en el teléfono" warning only when something is queued', () => {
    const { rerender } = render(
      <ManifestClosedSummary {...baseProps} pendingSync={{ records: 6, photos: 2 }} />,
    );
    expect(screen.getByText('Guardado en el teléfono')).toBeInTheDocument();
    expect(
      screen.getByText('6 registros y 2 fotos esperan señal para subir'),
    ).toBeInTheDocument();

    rerender(<ManifestClosedSummary {...baseProps} pendingSync={{ records: 0, photos: 0 }} />);
    expect(screen.queryByText('Guardado en el teléfono')).toBeNull();

    rerender(<ManifestClosedSummary {...baseProps} pendingSync={null} />);
    expect(screen.queryByText('Guardado en el teléfono')).toBeNull();
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

  it('the primary CTA calls onBackToRoute', async () => {
    const user = userEvent.setup();
    const onBackToRoute = vi.fn();
    render(<ManifestClosedSummary {...baseProps} onBackToRoute={onBackToRoute} />);

    await user.click(screen.getByRole('button', { name: 'Volver a mis recogidas' }));

    expect(onBackToRoute).toHaveBeenCalledOnce();
  });

  it('the secondary action calls onViewSummary', async () => {
    const user = userEvent.setup();
    const onViewSummary = vi.fn();
    render(<ManifestClosedSummary {...baseProps} onViewSummary={onViewSummary} />);

    await user.click(screen.getByRole('button', { name: 'Ver resumen de la carga' }));

    expect(onViewSummary).toHaveBeenCalledOnce();
  });
});
