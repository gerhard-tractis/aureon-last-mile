import { render, screen, within } from '@testing-library/react';
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
      searchInputId="search-input-1"
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

  // L4 (review) — el input necesita id propio para que el botón "Buscar"
  // de RouteFooterTopRow pueda apuntarle un aria-controls real.
  it('el campo de búsqueda lleva el id que se le pasa', () => {
    renderPanel({ searchOpen: true, searchInputId: 'mi-id-de-prueba' });
    expect(screen.getByRole('searchbox', { name: 'Buscar carga' })).toHaveAttribute(
      'id',
      'mi-id-de-prueba',
    );
  });

  // H3 (review) — mismo fix que PickupMobileActiveRoute.tsx N6 (review
  // round 3): el disparador vive en la barra fija de abajo y el campo
  // monta arriba de una lista que puede ser larga; sin desplazar el
  // viewport (no sólo el foco de teclado), el conductor teclea a ciegas.
  it('desplaza el campo a la vista al montarlo (no sólo mueve el foco)', () => {
    renderPanel({ searchOpen: true });
    const input = screen.getByRole('searchbox', { name: 'Buscar carga' });
    expect(input.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
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
        searchInputId="search-input-1"
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

  // H1 (review, ALTO) — el chip de grupo y su subtítulo deben seguir
  // reflejando la membresía REAL del grupo, no el subconjunto que matchea
  // la búsqueda. Falabella con una carga cerrada (LOAD-A) y otra abierta
  // sin tocar (LOAD-B, verified_count 0): sin búsqueda el chip es
  // PENDIENTE (LOAD-B abierta). Buscar "LOAD-A" oculta la fila de LOAD-B,
  // pero el grupo entero sigue siendo Falabella con sus dos cargas reales
  // — el chip NO puede pasar a COMPLETADA sólo porque la única fila
  // VISIBLE está cerrada.
  describe('el chip de grupo no miente bajo búsqueda', () => {
    const LOAD_A_CLOSED: RouteManifestRow = {
      id: 'a',
      external_load_id: 'LOAD-A',
      retailer_name: 'Falabella',
      pickup_location: 'Mall Plaza Vespucio',
      total_orders: 1,
      total_packages: 10,
      verified_count: 10,
    };
    const LOAD_B_OPEN: RouteManifestRow = {
      id: 'b',
      external_load_id: 'LOAD-B',
      retailer_name: 'Falabella',
      pickup_location: 'Parque Arauco',
      total_orders: 1,
      total_packages: 5,
      verified_count: 0,
    };

    it('sin búsqueda el grupo es PENDIENTE (LOAD-B sigue abierta)', () => {
      render(
        <RouteManifestPanel
          panelId="panel-1"
          searchInputId="search-input-1"
          manifests={[LOAD_A_CLOSED, LOAD_B_OPEN]}
          searchOpen={false}
          query=""
          onQueryChange={vi.fn()}
          onManifestClick={vi.fn()}
        />,
      );
      expect(screen.getByTestId('route-manifest-group-status')).toHaveTextContent('PENDIENTE');
    });

    it('buscando "LOAD-A" el grupo SIGUE PENDIENTE, no COMPLETADA, aunque sólo se vea esa fila', () => {
      render(
        <RouteManifestPanel
          panelId="panel-1"
          searchInputId="search-input-1"
          manifests={[LOAD_A_CLOSED, LOAD_B_OPEN]}
          searchOpen
          query="LOAD-A"
          onQueryChange={vi.fn()}
          onManifestClick={vi.fn()}
        />,
      );
      const group = screen.getByTestId('route-manifest-group');
      expect(within(group).getByTestId('route-manifest-group-status')).toHaveTextContent(
        'PENDIENTE',
      );
      // El subtítulo tampoco encoge: sigue reportando el grupo real (2
      // puntos), no el subconjunto visible (1 punto).
      expect(within(group).getByText(/2 puntos/)).toBeInTheDocument();
      // Y sólo la fila de LOAD-A está visible — LOAD-B sigue oculta.
      expect(screen.getByText('LOAD-A')).toBeInTheDocument();
      expect(screen.queryByText('LOAD-B')).toBeNull();
    });
  });
});
