import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { RouteFooterTopRow } from './RouteFooterTopRow';

/**
 * spec-95 fase 2 (mock 5c) — fila superior del pie: Buscar, el toggle de
 * manifiestos, Digitalizar manifiesto y +. Este componente embebe
 * `DigitalizeManifestTrigger`, así que necesita los mismos mocks mínimos
 * que `DigitalizeManifestTrigger.test.tsx` para montar sin tocar Supabase.
 */
vi.mock('@/hooks/pickup/useCameraIntake', () => ({
  useCameraIntake: () => ({
    submit: vi.fn(),
    reset: vi.fn(),
    status: 'idle',
    result: null,
    error: null,
    uploadProgress: null,
  }),
}));
vi.mock('@/hooks/useTenantClients', () => ({
  useTenantClients: () => ({ data: [{ id: 'client-1', name: 'Easy' }], isLoading: false }),
}));
vi.mock('@/hooks/pickup/usePickupPointsByClient', () => ({
  usePickupPointsByClient: () => ({ data: [], isLoading: false }),
}));
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-123' }),
}));

function renderRow(overrides: Partial<React.ComponentProps<typeof RouteFooterTopRow>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props: React.ComponentProps<typeof RouteFooterTopRow> = {
    manifestsCount: 2,
    showAll: false,
    manifestListPanelId: undefined,
    onToggleShowAll: vi.fn(),
    searchOpen: false,
    searchInputId: undefined,
    onToggleSearch: vi.fn(),
    onOpenAdd: vi.fn(),
    ...overrides,
  };
  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(RouteFooterTopRow, props),
    ),
  );
}

describe('RouteFooterTopRow', () => {
  it('renders Buscar, el toggle de manifiestos, Digitalizar manifiesto y + en la misma fila', () => {
    renderRow();
    const row = screen.getByTestId('route-footer-top-row');
    expect(row).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buscar carga' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver los 2 manifiestos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /digitalizar manifiesto/i })).toBeInTheDocument();
    expect(screen.getByTestId('open-add-manifest')).toBeInTheDocument();
  });

  it('no ofrece el toggle cuando la ruta no tiene manifiestos', () => {
    renderRow({ manifestsCount: 0 });
    expect(screen.queryByRole('button', { name: /ver/i })).toBeNull();
  });

  // El botón de búsqueda refleja su propio estado, no el de la lista — es
  // asertable como atributo, no sólo por presencia (lección de fases
  // hermanas: un botón que existe puede seguir sin cablear su semántica).
  it('refleja searchOpen en aria-expanded del botón Buscar', () => {
    const { rerender } = renderRow({ searchOpen: false });
    expect(screen.getByRole('button', { name: 'Buscar carga' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(RouteFooterTopRow, {
          manifestsCount: 2,
          showAll: false,
          manifestListPanelId: undefined,
          onToggleShowAll: vi.fn(),
          searchOpen: true,
          onToggleSearch: vi.fn(),
          onOpenAdd: vi.fn(),
        }),
      ),
    );
    expect(screen.getByRole('button', { name: 'Buscar carga' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  // aria-controls sólo debe apuntar a un id real: un idref colgante (el
  // panel no montado) es peor que omitir el atributo.
  it('sólo pone aria-controls en el toggle cuando el panel realmente está montado', () => {
    renderRow({ manifestListPanelId: undefined });
    expect(
      screen.getByRole('button', { name: 'Ver los 2 manifiestos' }),
    ).not.toHaveAttribute('aria-controls');
  });

  it('pone aria-controls en el toggle cuando se pasa el id del panel', () => {
    renderRow({ showAll: true, manifestListPanelId: 'route-manifest-list-panel' });
    expect(screen.getByRole('button', { name: 'Ocultar manifiestos' })).toHaveAttribute(
      'aria-controls',
      'route-manifest-list-panel',
    );
  });

  // L4 (review) — mismo criterio que el toggle de manifiestos: sin idref
  // colgante cuando el campo de búsqueda no está montado.
  it('no pone aria-controls en Buscar cuando no se pasa searchInputId', () => {
    renderRow({ searchInputId: undefined });
    expect(screen.getByRole('button', { name: 'Buscar carga' })).not.toHaveAttribute(
      'aria-controls',
    );
  });

  it('pone aria-controls en Buscar cuando se pasa el id del campo', () => {
    renderRow({ searchOpen: true, searchInputId: 'search-input-1' });
    expect(screen.getByRole('button', { name: 'Buscar carga' })).toHaveAttribute(
      'aria-controls',
      'search-input-1',
    );
  });

  // M2 (review, MEDIO) — el criterio de la fase es un ORDEN concreto
  // (Buscar, Ver manifiesto(s), Digitalizar, +), y ningún test previo lo
  // comprobaba: mover Digitalizar a primera posición o Cerrar/Cancelar de
  // lugar pasaba en verde igual. Se comprueba por posición real en el DOM,
  // no sólo por presencia de cada botón en cualquier parte del documento.
  it('mantiene el orden Buscar → Ver manifiesto(s) → Digitalizar → + de izquierda a derecha', () => {
    renderRow();
    const row = screen.getByTestId('route-footer-top-row');
    const children = Array.from(row.children) as HTMLElement[];
    expect(children).toHaveLength(4);
    expect(children[0]).toHaveAttribute('aria-label', 'Buscar carga');
    expect(children[1].textContent).toContain('Ver los 2 manifiestos');
    expect(children[2].textContent).toMatch(/digitalizar manifiesto/i);
    expect(children[3]).toHaveAttribute('data-testid', 'open-add-manifest');
  });
});
