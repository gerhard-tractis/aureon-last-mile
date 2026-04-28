import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ManualAssignMenu } from './ManualAssignMenu';
import type { DockZone } from '@/lib/distribution/sectorization-engine';

const zones: DockZone[] = [
  {
    id: 'zone-a',
    name: 'Andén A',
    code: 'A1',
    is_consolidation: false,
    is_active: true,
    comunas: [],
  },
  {
    id: 'zone-b',
    name: 'Andén B',
    code: 'B1',
    is_consolidation: false,
    is_active: true,
    comunas: [],
  },
  {
    id: 'zone-cons',
    name: 'Consolidación',
    code: 'CONS',
    is_consolidation: true,
    is_active: true,
    comunas: [],
  },
];

describe('ManualAssignMenu', () => {
  it('lists all active zones when opened', async () => {
    const user = userEvent.setup();
    render(
      <ManualAssignMenu packageId="pkg-1" activeZones={zones} onSelect={() => {}} />
    );
    await user.click(screen.getByRole('button', { name: /asignar manualmente/i }));
    expect(await screen.findByText('Andén A')).toBeInTheDocument();
    expect(screen.getByText('Andén B')).toBeInTheDocument();
    expect(screen.getByText('Consolidación')).toBeInTheDocument();
  });

  it('renders consolidación as the last item (after the andens)', async () => {
    const user = userEvent.setup();
    render(
      <ManualAssignMenu packageId="pkg-1" activeZones={zones} onSelect={() => {}} />
    );
    await user.click(screen.getByRole('button', { name: /asignar manualmente/i }));
    const items = await screen.findAllByRole('menuitem');
    const labels = items.map(i => i.textContent);
    expect(labels[labels.length - 1]).toMatch(/consolidación/i);
  });

  it('calls onSelect with zone id when an item is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ManualAssignMenu packageId="pkg-1" activeZones={zones} onSelect={onSelect} />
    );
    await user.click(screen.getByRole('button', { name: /asignar manualmente/i }));
    await user.click(await screen.findByText('Andén B'));
    expect(onSelect).toHaveBeenCalledWith('zone-b');
  });

  it('calls onSelect with consolidación zone id when consolidación is selected', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ManualAssignMenu packageId="pkg-1" activeZones={zones} onSelect={onSelect} />
    );
    await user.click(screen.getByRole('button', { name: /asignar manualmente/i }));
    await user.click(await screen.findByText('Consolidación'));
    expect(onSelect).toHaveBeenCalledWith('zone-cons');
  });

  it('omits inactive zones', async () => {
    const user = userEvent.setup();
    const mixed: DockZone[] = [
      ...zones,
      {
        id: 'zone-c',
        name: 'Andén C (inactivo)',
        code: 'C1',
        is_consolidation: false,
        is_active: false,
        comunas: [],
      },
    ];
    render(
      <ManualAssignMenu packageId="pkg-1" activeZones={mixed} onSelect={() => {}} />
    );
    await user.click(screen.getByRole('button', { name: /asignar manualmente/i }));
    await screen.findByText('Andén A');
    expect(screen.queryByText(/Andén C/)).not.toBeInTheDocument();
  });
});
