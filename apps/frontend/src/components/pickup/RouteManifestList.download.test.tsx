/**
 * spec-82 fase 2 — chip `DESCARGAR` por fila de `RouteManifestList` (mock
 * `5c`). Fichero separado de `RouteManifestList.test.tsx` sólo por tamaño
 * (regla de 300 líneas) — mismo componente, mismo patrón de tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouteManifestList, type RouteManifestRow } from './RouteManifestList';

function baseManifest(overrides: Partial<RouteManifestRow> = {}): RouteManifestRow {
  return {
    id: 'm1',
    external_load_id: 'CARGA-99817',
    retailer_name: 'Ripley',
    pickup_location: null,
    total_orders: 1,
    total_packages: 25,
    verified_count: 0,
    ...overrides,
  };
}

describe('RouteManifestList — chip DESCARGAR', () => {
  it('shows DESCARGAR when the carga is not complete and not in downloadedIds', () => {
    render(
      <RouteManifestList
        manifests={[baseManifest()]}
        onManifestClick={() => {}}
        downloadedIds={new Set()}
        onDownload={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /descargar carga-99817/i })).toBeInTheDocument();
  });

  it('does not show DESCARGAR when the carga is already downloaded', () => {
    render(
      <RouteManifestList
        manifests={[baseManifest()]}
        onManifestClick={() => {}}
        downloadedIds={new Set(['CARGA-99817'])}
        onDownload={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /descargar carga-99817/i })).toBeNull();
  });

  // "no lo sé todavía" — downloadedIds sigue resolviendo (undefined). No se
  // pinta DESCARGAR (sería mentir "no descargada" sobre algo que podría
  // estarlo) ni tampoco nada que sugiera que sí lo está.
  it('shows nothing while downloadedIds is still unknown (undefined)', () => {
    render(
      <RouteManifestList
        manifests={[baseManifest()]}
        onManifestClick={() => {}}
        downloadedIds={undefined}
        onDownload={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /descargar/i })).toBeNull();
  });

  it('does not render DESCARGAR when onDownload is not supplied, even if not downloaded', () => {
    render(
      <RouteManifestList
        manifests={[baseManifest()]}
        onManifestClick={() => {}}
        downloadedIds={new Set()}
      />,
    );
    expect(screen.queryByRole('button', { name: /descargar/i })).toBeNull();
  });

  // Colisión anotada en fase 1 y resuelta en fase 2: COMPLETADA gana.
  it('shows COMPLETADA, not DESCARGAR, when both predicates would apply (inconsistent data)', () => {
    render(
      <RouteManifestList
        manifests={[baseManifest({ total_packages: 5, verified_count: 5 })]}
        onManifestClick={() => {}}
        downloadedIds={new Set()}
        onDownload={() => {}}
      />,
    );
    expect(screen.getByText('COMPLETADA')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /descargar/i })).toBeNull();
  });

  it('calls onDownload with the manifest id and external_load_id when tapped', async () => {
    const onDownload = vi.fn();
    render(
      <RouteManifestList
        manifests={[baseManifest({ id: 'uuid-1', external_load_id: 'CARGA-X' })]}
        onManifestClick={() => {}}
        downloadedIds={new Set()}
        onDownload={onDownload}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /descargar carga-x/i }));
    expect(onDownload).toHaveBeenCalledWith('uuid-1', 'CARGA-X');
  });

  it('tapping DESCARGAR does not also fire onManifestClick', async () => {
    const onManifestClick = vi.fn();
    const onDownload = vi.fn();
    render(
      <RouteManifestList
        manifests={[baseManifest()]}
        onManifestClick={onManifestClick}
        downloadedIds={new Set()}
        onDownload={onDownload}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /descargar/i }));
    expect(onManifestClick).not.toHaveBeenCalled();
  });

  it('disables the DESCARGAR button while downloadingId matches this manifest', () => {
    render(
      <RouteManifestList
        manifests={[baseManifest({ id: 'uuid-1' })]}
        onManifestClick={() => {}}
        downloadedIds={new Set()}
        onDownload={() => {}}
        downloadingId="uuid-1"
      />,
    );
    expect(screen.getByRole('button', { name: /descargar/i })).toBeDisabled();
  });

  it('does not disable DESCARGAR for a different manifest while another one is downloading', () => {
    render(
      <RouteManifestList
        manifests={[baseManifest({ id: 'uuid-1', external_load_id: 'CARGA-1' })]}
        onManifestClick={() => {}}
        downloadedIds={new Set()}
        onDownload={() => {}}
        downloadingId="uuid-other"
      />,
    );
    expect(screen.getByRole('button', { name: /descargar/i })).not.toBeDisabled();
  });
});
