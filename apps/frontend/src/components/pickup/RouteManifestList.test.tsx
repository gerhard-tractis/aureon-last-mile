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
    expect(groupManifestStatus([], undefined)).toBe('pendiente');
  });

  it('is COMPLETADA when every manifest in the group is fully verified', () => {
    const group = [
      manifest({ id: 'm1', total_packages: 5, verified_count: 5 }),
      manifest({ id: 'm2', total_packages: 3, verified_count: 3 }),
    ];
    expect(groupManifestStatus(group, undefined)).toBe('completada');
  });

  it('is not COMPLETADA when only some manifests in the group are fully verified', () => {
    const group = [
      manifest({ id: 'm1', total_packages: 5, verified_count: 5 }),
      manifest({ id: 'm2', total_packages: 3, verified_count: 0 }),
    ];
    expect(groupManifestStatus(group, undefined)).not.toBe('completada');
  });

  it('is EN RUTA when a manifest has scanning started and nothing in the group is pending download', () => {
    const group = [manifest({ id: 'm1', total_packages: 5, verified_count: 2 })];
    const downloadedIds = new Set(['LOAD-1']);
    expect(groupManifestStatus(group, downloadedIds)).toBe('en_ruta');
  });

  it('is PENDIENTE (not EN RUTA) when scanning started but another manifest is pending download', () => {
    const group = [
      manifest({ id: 'm1', external_load_id: 'LOAD-1', total_packages: 5, verified_count: 2 }),
      manifest({ id: 'm2', external_load_id: 'LOAD-2', total_packages: 4, verified_count: 0 }),
    ];
    // downloadedIds resolved (not undefined) and LOAD-2 is missing from it —
    // that manifest is pending download, so the collision with COMPLETADA's
    // sibling rule ("gana COMPLETADA") does not apply here: this blocks
    // EN RUTA instead.
    const downloadedIds = new Set(['LOAD-1']);
    expect(groupManifestStatus(group, downloadedIds)).toBe('pendiente');
  });

  it('is PENDIENTE when nothing in the group has started scanning', () => {
    const group = [manifest({ verified_count: 0 })];
    expect(groupManifestStatus(group, new Set(['LOAD-1']))).toBe('pendiente');
  });

  it('never reads downloadedIds as "pending download" when it is undefined ("todavía no lo sé")', () => {
    // Same shape as the "PENDIENTE (not EN RUTA)" case above, but
    // downloadedIds is unresolved — must not flip EN RUTA to PENDIENTE just
    // because we do not know yet whether LOAD-2 was downloaded.
    const group = [
      manifest({ id: 'm1', external_load_id: 'LOAD-1', total_packages: 5, verified_count: 2 }),
      manifest({ id: 'm2', external_load_id: 'LOAD-2', total_packages: 4, verified_count: 0 }),
    ];
    expect(groupManifestStatus(group, undefined)).toBe('en_ruta');
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

    it('shows an EN RUTA group chip when scanning started and downloadedIds resolves nothing pending', () => {
      render(
        <RouteManifestList
          manifests={[groupManifest({ total_packages: 5, verified_count: 2 })]}
          onManifestClick={() => {}}
          downloadedIds={new Set(['LOAD-1'])}
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
