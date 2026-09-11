import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouteManifestList, groupManifestStatus, type RouteManifestRow } from './RouteManifestList';

// spec-95 fase 1 (mock 5c) — la regla única de chip por grupo de cliente.
// Un caso por rama, más el de frontera (grupo vacío), tal como pide el spec.
// Probado como unidad, no leído del render.
function manifest(overrides: Partial<RouteManifestRow> = {}): RouteManifestRow {
  return {
    id: 'm1',
    external_load_id: 'LOAD-1',
    retailer_name: 'A',
    pickup_location: null,
    total_orders: 1,
    total_packages: 10,
    verified_count: 0,
    ...overrides,
  };
}

describe('groupManifestStatus', () => {
  it('is PENDIENTE for an empty group (frontier case)', () => {
    expect(groupManifestStatus([])).toBe('pendiente');
  });

  it('is COMPLETADA when every manifest in the group is fully verified', () => {
    const group = [
      manifest({ id: 'm1', total_packages: 5, verified_count: 5 }),
      manifest({ id: 'm2', total_packages: 3, verified_count: 3 }),
    ];
    expect(groupManifestStatus(group)).toBe('completada');
  });

  it('is not COMPLETADA when only some manifests in the group are fully verified', () => {
    const group = [
      manifest({ id: 'm1', total_packages: 5, verified_count: 5 }),
      manifest({ id: 'm2', total_packages: 3, verified_count: 0 }),
    ];
    expect(groupManifestStatus(group)).not.toBe('completada');
  });

  it('is EN RUTA when a manifest has scanning started and is not closed', () => {
    const group = [manifest({ id: 'm1', total_packages: 5, verified_count: 2 })];
    expect(groupManifestStatus(group)).toBe('en_ruta');
  });

  // Regla A, decisión del usuario/diseñador 2026-09-11 — la descarga local
  // (chip DESCARGAR por manifiesto, spec-82 fase 2) quedó fuera del
  // predicado de grupo: es ortogonal al progreso de escaneo. Este caso antes
  // se llamaba "is PENDIENTE (not EN RUTA) when ... is pending download" y
  // esperaba 'pendiente' bajo la regla vieja; con la regla nueva el mismo
  // escenario (una carga con escaneo abierto, otra sin tocar) da 'en_ruta'
  // sin mirar descarga en absoluto.
  it('is EN RUTA when scanning started on one manifest, regardless of another manifest being undownloaded', () => {
    const group = [
      manifest({ id: 'm1', external_load_id: 'LOAD-1', total_packages: 5, verified_count: 2 }),
      manifest({ id: 'm2', external_load_id: 'LOAD-2', total_packages: 4, verified_count: 0 }),
    ];
    expect(groupManifestStatus(group)).toBe('en_ruta');
  });

  it('is PENDIENTE when nothing in the group has started scanning', () => {
    const group = [manifest({ verified_count: 0 })];
    expect(groupManifestStatus(group)).toBe('pendiente');
  });

  // El "sin cerrar" del predicado tiene que estar testeado por sí mismo, no
  // sólo implícito en el caso EN RUTA de arriba: la única carga con
  // escaneos ya cerró (isManifestComplete), y ninguna otra tiene escaneos —
  // el grupo entero cae a PENDIENTE, no a EN RUTA.
  it('is PENDIENTE when the only manifest with scans is already closed and nothing else has scans', () => {
    const group = [
      manifest({ id: 'm1', total_packages: 5, verified_count: 5 }), // closed
      manifest({ id: 'm2', total_packages: 4, verified_count: 0 }), // untouched
    ];
    expect(groupManifestStatus(group)).toBe('pendiente');
  });
});

describe('RouteManifestList', () => {
  it('shows empty state when no manifests', () => {
    render(<RouteManifestList manifests={[]} onManifestClick={() => {}} />);
    expect(screen.getByText(/Sin manifiestos en la ruta/i)).toBeInTheDocument();
  });

  it('renders each manifest with verified/expected counts', () => {
    render(
      <RouteManifestList
        manifests={[
          {
            id: 'm1',
            external_load_id: 'LOAD-1',
            retailer_name: 'Retailer A',
            pickup_location: null,
            total_orders: 4,
            total_packages: 10,
            verified_count: 7,
          },
        ]}
        onManifestClick={() => {}}
      />
    );
    expect(screen.getByText('Retailer A')).toBeInTheDocument();
    expect(screen.getByText('LOAD-1')).toBeInTheDocument();
    expect(screen.getByText('7/10')).toBeInTheDocument();
  });

  it('fires onManifestClick with external_load_id', () => {
    const onClick = vi.fn();
    render(
      <RouteManifestList
        manifests={[
          {
            id: 'm1',
            external_load_id: 'LOAD-1',
            retailer_name: 'A',
            pickup_location: null,
            total_orders: 1,
            total_packages: 1,
            verified_count: 1,
          },
        ]}
        onManifestClick={onClick}
      />
    );
    // spec-95 fase 1 — el nombre del retailer ahora sólo vive en la
    // cabecera de grupo ('A'), fuera del <button> de la fila; el
    // external_load_id sigue siendo único dentro de la fila y es lo que
    // localiza el <button> a pulsar.
    fireEvent.click(screen.getByText('LOAD-1').closest('button')!);
    expect(onClick).toHaveBeenCalledWith('LOAD-1');
  });

  // spec-54 phase 4.6 fix: `verified_count < (total_packages ?? 0)` read a
  // null total as zero, so a manifest intake never recorded a count was
  // silently declared complete. Originally asserted the pre-spec-82 copy
  // "Verificación completa"; spec-82 fase 1 replaced that text with the
  // COMPLETADA chip (mock 5c), so the string this test guarded against no
  // longer exists anywhere in the repo and the old assertion could never
  // fail — reasserted against the chip that replaced it.
  it('shows an unknown total as "N/—" and never claims it is complete', () => {
    render(
      <RouteManifestList
        manifests={[
          {
            id: 'm1',
            external_load_id: 'LOAD-1',
            retailer_name: 'A',
            pickup_location: null,
            total_orders: 1,
            total_packages: null,
            verified_count: 3,
          },
        ]}
        onManifestClick={() => {}}
      />
    );
    expect(screen.getByText('3/—')).toBeInTheDocument();
    expect(screen.queryByText('COMPLETADA')).toBeNull();
  });

  // spec-82 fase 1 (mock 5c) — a finished manifest carries a COMPLETADA
  // chip, the same visual state PickupMobileCompactRow already shows for
  // its `completed` variant on the 3h screen.
  it('shows a COMPLETADA chip when the manifest is fully verified', () => {
    render(
      <RouteManifestList
        manifests={[
          {
            id: 'm1',
            external_load_id: 'LOAD-1',
            retailer_name: 'A',
            pickup_location: null,
            total_orders: 1,
            total_packages: 5,
            verified_count: 5,
          },
        ]}
        onManifestClick={() => {}}
      />
    );
    // spec-95 fase 1 — un único manifiesto completo también hace COMPLETADA
    // el chip de su grupo (mismo texto, dos niveles): el chip por manifiesto
    // (`spec-82` fase 1) y el chip de grupo (`spec-95` fase 1) coexisten.
    expect(screen.getAllByText('COMPLETADA')).toHaveLength(2);
  });

  it('does not show a COMPLETADA chip when the manifest is not fully verified', () => {
    render(
      <RouteManifestList
        manifests={[
          {
            id: 'm1',
            external_load_id: 'LOAD-1',
            retailer_name: 'A',
            pickup_location: null,
            total_orders: 1,
            total_packages: 5,
            verified_count: 2,
          },
        ]}
        onManifestClick={() => {}}
      />
    );
    expect(screen.queryByText('COMPLETADA')).toBeNull();
  });

  // spec-64 Task 3 — the remove control.
  function baseManifest(overrides: Partial<Parameters<typeof RouteManifestList>[0]['manifests'][0]> = {}) {
    return {
      id: 'm1',
      external_load_id: 'LOAD-1',
      retailer_name: 'Retailer A',
      pickup_location: null,
      total_orders: 1,
      total_packages: 1,
      verified_count: 0,
      ...overrides,
    };
  }

  const REMOVE_LABEL = 'Quitar LOAD-1 de la ruta en curso';

  it('renders the remove control when verified_count is 0 and onRemove is supplied', () => {
    render(
      <RouteManifestList
        manifests={[baseManifest({ verified_count: 0 })]}
        onManifestClick={() => {}}
        onRemove={() => {}}
      />
    );
    expect(screen.getByRole('button', { name: REMOVE_LABEL })).toBeInTheDocument();
  });

  it('does not render the remove control when verified_count is greater than 0', () => {
    render(
      <RouteManifestList
        manifests={[baseManifest({ verified_count: 1 })]}
        onManifestClick={() => {}}
        onRemove={() => {}}
      />
    );
    expect(screen.queryByRole('button', { name: REMOVE_LABEL })).toBeNull();
  });

  it('does not render the remove control when onRemove is not supplied, even at verified_count 0', () => {
    render(
      <RouteManifestList
        manifests={[baseManifest({ verified_count: 0 })]}
        onManifestClick={() => {}}
      />
    );
    expect(screen.queryByRole('button', { name: REMOVE_LABEL })).toBeNull();
  });

  it('calls onRemove with the manifest id (not the external_load_id) when the dialog is confirmed', async () => {
    const onRemove = vi.fn();
    render(
      <RouteManifestList
        manifests={[baseManifest({ id: 'uuid-123', verified_count: 0 })]}
        onManifestClick={() => {}}
        onRemove={onRemove}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: REMOVE_LABEL }));
    const confirmButton = await screen.findByRole('button', { name: /^Quitar$/i });
    await userEvent.click(confirmButton);
    expect(onRemove).toHaveBeenCalledWith('uuid-123');
    expect(onRemove).not.toHaveBeenCalledWith('LOAD-1');
  });

  it('does not call onRemove when the dialog is dismissed', async () => {
    const onRemove = vi.fn();
    render(
      <RouteManifestList
        manifests={[baseManifest({ verified_count: 0 })]}
        onManifestClick={() => {}}
        onRemove={onRemove}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: REMOVE_LABEL }));
    const cancelButton = await screen.findByRole('button', { name: /cancelar/i });
    await userEvent.click(cancelButton);
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('clicking the row body still fires onManifestClick and does not call onRemove', async () => {
    const onClick = vi.fn();
    const onRemove = vi.fn();
    render(
      <RouteManifestList
        manifests={[baseManifest({ verified_count: 0 })]}
        onManifestClick={onClick}
        onRemove={onRemove}
      />
    );
    // spec-95 fase 1 — mismo motivo que arriba: 'Retailer A' ahora sólo vive
    // en la cabecera de grupo, fuera del <button> de la fila.
    fireEvent.click(screen.getByText('LOAD-1').closest('button')!);
    expect(onClick).toHaveBeenCalledWith('LOAD-1');
    expect(onRemove).not.toHaveBeenCalled();
  });

  // Every visibility test above uses a single-row list, so `canRemove` is
  // never exercised per-row there. This pins the gate to each manifest,
  // not hoisted out of the map from the first row.
  it('gates the remove control per row in a mixed list, not from the first manifest', () => {
    render(
      <RouteManifestList
        manifests={[
          baseManifest({ id: 'm1', external_load_id: 'LOAD-1', verified_count: 0 }),
          baseManifest({ id: 'm2', external_load_id: 'LOAD-2', verified_count: 2 }),
        ]}
        onManifestClick={() => {}}
        onRemove={() => {}}
      />
    );
    const removeButtons = screen.getAllByRole('button', {
      name: /^Quitar LOAD-\d de la ruta en curso$/,
    });
    expect(removeButtons).toHaveLength(1);
    expect(removeButtons[0]).toHaveAccessibleName('Quitar LOAD-1 de la ruta en curso');
  });

  // spec-64 review fix 1(a) — a double-tap while the removal is in flight
  // must not fire a second `mutate` for the same manifest: the row and its
  // X stay in the DOM until `route-manifests` refetches, and the server's
  // second refusal would otherwise surface as a raw guard-6 message.
  it('disables the remove trigger while isRemoving is true', () => {
    render(
      <RouteManifestList
        manifests={[baseManifest({ verified_count: 0 })]}
        onManifestClick={() => {}}
        onRemove={() => {}}
        isRemoving
      />
    );
    expect(screen.getByRole('button', { name: REMOVE_LABEL })).toBeDisabled();
  });

  it('does not disable the remove trigger when isRemoving is omitted', () => {
    render(
      <RouteManifestList
        manifests={[baseManifest({ verified_count: 0 })]}
        onManifestClick={() => {}}
        onRemove={() => {}}
      />
    );
    expect(screen.getByRole('button', { name: REMOVE_LABEL })).not.toBeDisabled();
  });

  // spec-64 review fix 2 — the spec names this case explicitly: removing the
  // last manifest must leave the list's own EmptyState, not a broken
  // routeComplete render. Correct by construction (manifests.length === 0
  // above), but was never asserted directly for a list going TO zero.
  it('renders EmptyState and no remove control when the manifest list is empty', () => {
    render(
      <RouteManifestList manifests={[]} onManifestClick={() => {}} onRemove={() => {}} />
    );
    expect(screen.getByText(/Sin manifiestos en la ruta/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Quitar .* de la ruta en curso$/ })).toBeNull();
  });

  // spec-95 fase 1 (mock 5c) — agrupación por cliente, con la cabecera del
  // mock ("nombre" + "N puntos · M paquetes") y el chip de la regla única.
  describe('agrupación por cliente', () => {
    function groupManifest(overrides: Partial<RouteManifestRow> = {}): RouteManifestRow {
      return {
        id: 'm1',
        external_load_id: 'LOAD-1',
        retailer_name: 'Falabella',
        pickup_location: 'Mall Plaza Vespucio',
        total_orders: 18,
        total_packages: 42,
        verified_count: 0,
        ...overrides,
      };
    }

    it('groups manifests under one header per retailer_name, with N puntos · M paquetes', () => {
      render(
        <RouteManifestList
          manifests={[
            groupManifest({ id: 'm1', external_load_id: 'LOAD-1', total_packages: 42 }),
            groupManifest({
              id: 'm2',
              external_load_id: 'LOAD-2',
              pickup_location: 'Parque Arauco',
              total_packages: 25,
            }),
            groupManifest({
              id: 'm3',
              external_load_id: 'LOAD-3',
              retailer_name: 'Ripley',
              pickup_location: 'Alto Las Condes',
              total_packages: 25,
            }),
          ]}
          onManifestClick={() => {}}
        />
      );
      const groups = screen.getAllByTestId('route-manifest-group');
      expect(groups).toHaveLength(2);
      expect(within(groups[0]).getByText('Falabella')).toBeInTheDocument();
      expect(within(groups[0]).getByText('2 puntos · 67 paquetes')).toBeInTheDocument();
      expect(within(groups[1]).getByText('Ripley')).toBeInTheDocument();
      expect(within(groups[1]).getByText('1 punto · 25 paquetes')).toBeInTheDocument();
    });

    it('shows a COMPLETADA group chip when every manifest in the group is closed', () => {
      render(
        <RouteManifestList
          manifests={[groupManifest({ total_packages: 5, verified_count: 5 })]}
          onManifestClick={() => {}}
        />
      );
      // spec-95 fase 1 — con un solo manifiesto en el grupo, el chip
      // por-manifiesto (spec-82 fase 1) y el chip de grupo coinciden en
      // texto; se localiza el de grupo por su testid, no por texto.
      expect(screen.getByTestId('route-manifest-group-status')).toHaveTextContent('COMPLETADA');
    });

    it('shows an EN RUTA group chip when a manifest has scanning started and is not closed', () => {
      render(
        <RouteManifestList
          manifests={[groupManifest({ total_packages: 5, verified_count: 2 })]}
          onManifestClick={() => {}}
        />
      );
      const group = screen.getByTestId('route-manifest-group');
      expect(within(group).getByText('EN RUTA')).toBeInTheDocument();
    });

    it('shows a PENDIENTE group chip when nothing in the group has started', () => {
      render(
        <RouteManifestList
          manifests={[groupManifest({ total_packages: 5, verified_count: 0 })]}
          onManifestClick={() => {}}
        />
      );
      const group = screen.getByTestId('route-manifest-group');
      expect(within(group).getByText('PENDIENTE')).toBeInTheDocument();
    });

    // spec-95 fase 1 — el slot de cabecera de grupo nunca ofrece un botón
    // "Ver carga": la regla única de chip lo reemplaza en los cuatro casos.
    it('never renders a "Ver carga" affordance in the group header slot', () => {
      render(
        <RouteManifestList
          manifests={[groupManifest()]}
          onManifestClick={() => {}}
        />
      );
      expect(screen.queryByText(/ver carga/i)).not.toBeInTheDocument();
    });
  });
});
