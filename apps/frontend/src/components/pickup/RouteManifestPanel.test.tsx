import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { RouteManifestPanel } from './RouteManifestPanel';
import type { RouteManifestRow } from './RouteManifestList';

const ACME: RouteManifestRow = {
  id: 'm1',
  external_load_id: 'LOAD-1',
  retailer_name: 'Acme',
  pickup_location: 'Bodega Norte',
  total_orders: 1,
  total_packages: 2,
  verified_count: 0,
};

const BETA: RouteManifestRow = {
  id: 'm2',
  external_load_id: 'LOAD-2',
  retailer_name: 'Beta',
  pickup_location: 'Bodega Sur',
  total_orders: 1,
  total_packages: 2,
  verified_count: 0,
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof RouteManifestPanel>> = {}) {
  return render(
    <RouteManifestPanel
      panelId="panel-1"
      manifests={[ACME, BETA]}
      searchOpen={false}
      query=""
      onQueryChange={vi.fn()}
      onManifestClick={vi.fn()}
      {...overrides}
    />,
  );
}

describe('RouteManifestPanel', () => {
  it('sin búsqueda muestra todos los grupos', () => {
    renderPanel();
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('no muestra el campo de búsqueda cuando searchOpen es false', () => {
    renderPanel();
    expect(screen.queryByRole('searchbox', { name: 'Buscar carga' })).toBeNull();
  });

  it('muestra el campo cuando searchOpen es true', () => {
    renderPanel({ searchOpen: true });
    expect(screen.getByRole('searchbox', { name: 'Buscar carga' })).toBeInTheDocument();
  });

  it('filtra por retailer_name cuando hay query', () => {
    renderPanel({ searchOpen: true, query: 'Acme' });
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.queryByText('Beta')).toBeNull();
  });

  it('filtra por pickup_location cuando hay query', () => {
    renderPanel({ searchOpen: true, query: 'Bodega Sur' });
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.queryByText('Acme')).toBeNull();
  });

  it('filtra por external_load_id cuando hay query', () => {
    renderPanel({ searchOpen: true, query: 'LOAD-2' });
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.queryByText('Acme')).toBeNull();
  });

  // pickup_location null es frecuente (no capturado en intake) — el
  // predicado no debe reventar ni, por un `??` mal puesto, hacer que un
  // manifiesto sin punto de recogida "matchee" cualquier búsqueda.
  it('un manifiesto con pickup_location null no matchea una búsqueda arbitraria', () => {
    const noPoint: RouteManifestRow = { ...ACME, id: 'm3', external_load_id: 'LOAD-3', retailer_name: 'Gamma', pickup_location: null };
    render(
      <RouteManifestPanel
        panelId="panel-1"
        manifests={[noPoint]}
        searchOpen
        query="no-deberia-matchear"
        onQueryChange={vi.fn()}
        onManifestClick={vi.fn()}
      />,
    );
    expect(screen.queryByText('Gamma')).toBeNull();
    expect(screen.getByText(/sin resultados/i)).toBeInTheDocument();
  });

  it('muestra "sin resultados" en vez de "Sin manifiestos en la ruta" cuando la búsqueda no encuentra nada', () => {
    renderPanel({ searchOpen: true, query: 'nada-coincide' });
    expect(screen.queryByTestId('route-manifest-list')).toBeNull();
    expect(screen.getByText(/sin resultados/i)).toBeInTheDocument();
    expect(screen.queryByText(/sin manifiestos en la ruta/i)).toBeNull();
  });

  it('una query en blanco no filtra nada (frontera: espacios)', () => {
    renderPanel({ searchOpen: true, query: '   ' });
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  // Frontera: una ruta genuinamente vacía, SIN búsqueda activa, debe seguir
  // mostrando el "Sin manifiestos en la ruta" de RouteManifestList — no el
  // "sin resultados" de búsqueda, que sería una mentira (no hubo búsqueda).
  it('sin búsqueda y sin manifiestos muestra el vacío real, no "sin resultados"', () => {
    renderPanel({ manifests: [], query: '' });
    expect(screen.getByText(/sin manifiestos en la ruta/i)).toBeInTheDocument();
    expect(screen.queryByText(/sin resultados/i)).toBeNull();
  });

  // Misma frontera que arriba, pero con una query de puros espacios: sigue
  // sin ser una búsqueda real (`query.trim()` vacío), así que el vacío
  // genuino no debe leerse como "sin resultados de búsqueda".
  it('una query de sólo espacios y sin manifiestos tampoco cuenta como búsqueda', () => {
    renderPanel({ manifests: [], query: '   ' });
    expect(screen.getByText(/sin manifiestos en la ruta/i)).toBeInTheDocument();
    expect(screen.queryByText(/sin resultados/i)).toBeNull();
  });
});
