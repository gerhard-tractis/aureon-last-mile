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

  // Review finding 5 — pedido explícitamente y no estaba: un grupo mixto de
  // tres (una cerrada, una empezada y sin cerrar, una sin tocar) tiene que
  // dar EN RUTA. El comportamiento ya era correcto; faltaba fijarlo.
  it('is EN RUTA for a mixed group: one closed, one started and open, one untouched', () => {
    const group = [
      manifest({ id: 'm1', total_packages: 5, verified_count: 5 }), // closed
      manifest({ id: 'm2', total_packages: 5, verified_count: 2 }), // started, open
      manifest({ id: 'm3', total_packages: 4, verified_count: 0 }), // untouched
    ];
    expect(groupManifestStatus(group)).toBe('en_ruta');
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
    // Review finding 4 — con `pickup_location: null` la fila cae al
    // fallback `retailer_name` (no a un texto genérico "sin registrar"),
    // así que 'Retailer A' aparece dos veces: cabecera de grupo + título de
    // fila. Ambas apariciones son correctas.
    expect(screen.getAllByText('Retailer A')).toHaveLength(2);
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

    // Review finding 1 — BUG REAL. `total_packages: null` es "desconocido",
    // no cero (manifestProgress.ts). Antes `?? 0` presentaba una suma
    // PARCIAL como si fuera el total del grupo: LOAD-1 (42) + LOAD-2
    // (null) pintaba "42 paquetes" en la cabecera mientras la fila de
    // LOAD-2 mostraba "0/—" al lado — dos cifras contradictorias en la
    // misma pantalla. Con `sumExpected` (mismo helper que
    // RouteProgressHeader.tsx y PickupMobileActiveRoute.tsx ya usan para
    // este mismo problema) el grupo entero pinta "—", nunca un denominador
    // inventado. Mutación que esto mata: `?? 0` → `?? 777` (sobrevivía
    // 28/28 antes de este test).
    it('shows "—" paquetes when any manifest in the group has an unknown total_packages', () => {
      render(
        <RouteManifestList
          manifests={[
            groupManifest({ id: 'm1', external_load_id: 'LOAD-1', total_packages: 42 }),
            groupManifest({
              id: 'm2',
              external_load_id: 'LOAD-2',
              pickup_location: 'Parque Arauco',
              total_packages: null,
            }),
          ]}
          onManifestClick={() => {}}
        />
      );
      expect(screen.getByText('2 puntos · — paquetes')).toBeInTheDocument();
      expect(screen.queryByText(/42 paquetes/)).not.toBeInTheDocument();
    });

    // Review finding 2 — `pointCount` no estaba testeado más allá del caso
    // feliz (puntos ya distintos), así que `= group.manifests.length`
    // pasaba 41/41. Dos cargas en el MISMO punto cuentan como un solo
    // punto.
    it('counts a repeated pickup_location as one point, not one per manifest', () => {
      render(
        <RouteManifestList
          manifests={[
            groupManifest({ id: 'm1', external_load_id: 'LOAD-1', pickup_location: 'Mall Plaza Vespucio' }),
            groupManifest({ id: 'm2', external_load_id: 'LOAD-2', pickup_location: 'Mall Plaza Vespucio' }),
          ]}
          onManifestClick={() => {}}
        />
      );
      expect(screen.getByText('1 punto · 84 paquetes')).toBeInTheDocument();
    });

    // Mismo hallazgo — el docstring de `groupManifestsByRetailer` afirma
    // que un `pickup_location: null` cuenta como un único punto
    // "desconocido"; sin este test esa afirmación no estaba probada.
    it('counts pickup_location: null manifests together as one unknown point', () => {
      render(
        <RouteManifestList
          manifests={[
            groupManifest({ id: 'm1', external_load_id: 'LOAD-1', pickup_location: null }),
            groupManifest({ id: 'm2', external_load_id: 'LOAD-2', pickup_location: null }),
          ]}
          onManifestClick={() => {}}
        />
      );
      expect(screen.getByText('1 punto · 84 paquetes')).toBeInTheDocument();
    });

    // Review finding 3 — BUG. `retailer_name: ''` pasaba de largo el `??`
    // (sólo captura null/undefined) y dejaba la cabecera sin nombre; peor,
    // '' y null formaban dos grupos separados para dos cargas igualmente
    // anónimas. Mutación que esto mata: fallback → `?? ''` (sobrevivía
    // 41/41 antes de este test). Cadena unificada con el precedente del
    // repo (`pickupStartRouteGrouping.ts`'s `NO_CLIENT`): "Sin cliente".
    it('groups retailer_name: null and retailer_name: \'\' together, under "Sin cliente"', () => {
      render(
        <RouteManifestList
          manifests={[
            groupManifest({ id: 'm1', external_load_id: 'LOAD-1', retailer_name: null }),
            groupManifest({ id: 'm2', external_load_id: 'LOAD-2', retailer_name: '' }),
          ]}
          onManifestClick={() => {}}
        />
      );
      const groups = screen.getAllByTestId('route-manifest-group');
      expect(groups).toHaveLength(1);
      expect(within(groups[0]).getByText('Sin cliente')).toBeInTheDocument();
    });

    // Review finding 4 — el fallback de la fila cuando `pickup_location` es
    // null no debe perder del todo la información: cae a `retailer_name`
    // antes de un texto genérico. Con dos cargas SIN dirección del mismo
    // retailer, antes ambas filas decían lo mismo ("Punto de recogida sin
    // registrar") y sólo se distinguían por el external_load_id en mono.
    it('falls back the row title to retailer_name when pickup_location is null', () => {
      render(
        <RouteManifestList
          manifests={[
            groupManifest({ id: 'm1', external_load_id: 'LOAD-1', pickup_location: null }),
            groupManifest({ id: 'm2', external_load_id: 'LOAD-2', pickup_location: null }),
          ]}
          onManifestClick={() => {}}
        />
      );
      // Cabecera de grupo (<h3>) + las dos filas (<h4>), las tres dicen
      // "Falabella" — nada se pierde.
      expect(screen.getAllByText('Falabella')).toHaveLength(3);
    });

    // Sólo cuando NINGUNA de las dos identidades está disponible cae al
    // texto genérico compartido con `3j` (`NO_POINT`, "Sin punto de
    // recogida").
    it('falls back the row title to "Sin punto de recogida" when both pickup_location and retailer_name are missing', () => {
      render(
        <RouteManifestList
          manifests={[
            groupManifest({
              id: 'm1',
              external_load_id: 'LOAD-1',
              pickup_location: null,
              retailer_name: null,
            }),
          ]}
          onManifestClick={() => {}}
        />
      );
      expect(screen.getByText('Sin punto de recogida')).toBeInTheDocument();
    });

    // Review finding 4 (a11y) — la jerarquía de encabezados coincide con la
    // jerarquía visual: <h3> el cliente (cabecera de grupo), <h4> el punto
    // de cada manifiesto debajo.
    it('uses <h3> for the group header and <h4> for each manifest row, matching the visual hierarchy', () => {
      render(
        <RouteManifestList
          manifests={[
            groupManifest({ id: 'm1', external_load_id: 'LOAD-1' }),
            groupManifest({ id: 'm2', external_load_id: 'LOAD-2', pickup_location: 'Parque Arauco' }),
          ]}
          onManifestClick={() => {}}
        />
      );
      expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1);
      expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(2);
    });
  });
});
