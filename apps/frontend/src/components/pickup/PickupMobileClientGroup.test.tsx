import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PickupMobileClientGroup } from './PickupMobileClientGroup';
import { groupPendingManifests, clientSelectionState } from '@/lib/pickup/pickupStartRouteGrouping';
import type { ManifestRow } from './ManifestTable';

const rows: ManifestRow[] = [
  {
    id: 'm1',
    externalLoadId: 'CARGA-99814',
    pickupPoint: 'Mall Plaza Vespucio',
    retailerName: 'Falabella',
    orderCount: 18,
    packageCount: 42,
    verifiedCount: 0,
  },
  {
    id: 'm2',
    externalLoadId: 'CARGA-99815',
    pickupPoint: 'Mall Plaza Vespucio',
    retailerName: 'Falabella',
    orderCount: 4,
    packageCount: 25,
    verifiedCount: 0,
  },
];

function renderGroup(overrides: Partial<Parameters<typeof PickupMobileClientGroup>[0]> = {}) {
  const group = groupPendingManifests(rows)[0];
  const selectedIds = overrides.selectedIds ?? new Set<string>();
  const props = {
    group,
    selectionState: clientSelectionState(group.selectableIds, selectedIds),
    selectedIds,
    onToggleSelect: vi.fn(),
    onToggleClient: vi.fn(),
    ...overrides,
  };
  render(<PickupMobileClientGroup {...props} />);
  return props;
}

describe('PickupMobileClientGroup', () => {
  it('shows the client summary line: N puntos · N paquetes', () => {
    renderGroup();
    expect(screen.getByText('Falabella')).toBeInTheDocument();
    expect(screen.getByText('1 punto · 67 paquetes')).toBeInTheDocument();
  });

  it('the pickup point is a header only — not a checkbox or button', () => {
    renderGroup();
    expect(screen.getByText('Mall Plaza Vespucio')).toBeInTheDocument();
    // Only the client checkbox + two manifest checkboxes exist — no third
    // checkbox for the point, and the point text itself is not clickable.
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
  });

  it('client checkbox is unchecked when nothing under it is selected', () => {
    renderGroup({ selectionState: 'none' });
    const clientCheckbox = screen.getByRole('checkbox', {
      name: 'Seleccionar todos los manifiestos de Falabella',
    });
    expect(clientCheckbox).toHaveAttribute('aria-checked', 'false');
  });

  it('client checkbox is "mixed" when only some manifests are selected', () => {
    renderGroup({ selectionState: 'some' });
    const clientCheckbox = screen.getByRole('checkbox', {
      name: 'Seleccionar todos los manifiestos de Falabella',
    });
    expect(clientCheckbox).toHaveAttribute('aria-checked', 'mixed');
  });

  it('client checkbox is "true" when every manifest under it is selected', () => {
    renderGroup({ selectionState: 'all' });
    const clientCheckbox = screen.getByRole('checkbox', {
      name: 'Seleccionar todos los manifiestos de Falabella',
    });
    expect(clientCheckbox).toHaveAttribute('aria-checked', 'true');
  });

  it('tapping the client checkbox calls onToggleClient', async () => {
    const onToggleClient = vi.fn();
    renderGroup({ onToggleClient });
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Seleccionar todos los manifiestos de Falabella' }),
    );
    expect(onToggleClient).toHaveBeenCalledTimes(1);
  });

  it('tapping a manifest checkbox calls onToggleSelect with that manifest id', async () => {
    const onToggleSelect = vi.fn();
    renderGroup({ onToggleSelect });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar CARGA-99814' }));
    expect(onToggleSelect).toHaveBeenCalledWith('m1');
  });

  // Review fix — the manifest row is selection-only. There is no "open"
  // affordance on 3j any more (see PickupMobileClientGroup.tsx file header):
  // opening a manifest with no route to attach it to wrote `status:
  // 'in_progress'` with nothing to scan against.
  it('the manifest row has no open/navigate affordance — only a checkbox', () => {
    renderGroup();
    expect(screen.queryByTestId('mobile-manifest-open')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /abrir/i })).not.toBeInTheDocument();
  });

  it('collapsing the client hides its points and manifests', async () => {
    renderGroup();
    expect(screen.getByText('Mall Plaza Vespucio')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { expanded: true }));
    expect(screen.queryByText('Mall Plaza Vespucio')).not.toBeInTheDocument();
    // The summary line survives collapse.
    expect(screen.getByText('1 punto · 67 paquetes')).toBeInTheDocument();
  });
});
