import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouteManifestList } from './RouteManifestList';

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
    fireEvent.click(screen.getByText('A').closest('button')!);
    expect(onClick).toHaveBeenCalledWith('LOAD-1');
  });

  // spec-54 phase 4.6 fix: `verified_count < (total_packages ?? 0)` read a
  // null total as zero, so a manifest intake never recorded a count for
  // silently rendered as "Verificación completa".
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
    expect(screen.queryByText('Verificación completa')).toBeNull();
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
    fireEvent.click(screen.getByText('Retailer A').closest('button')!);
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
});
