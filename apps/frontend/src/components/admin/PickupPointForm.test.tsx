import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PickupPointForm } from './PickupPointForm';

vi.mock('@/lib/stores/pickupPointStore', () => ({
  usePickupPointStore: () => ({
    setCreateFormOpen: vi.fn(),
    setEditFormOpen: vi.fn(),
  }),
}));

vi.mock('@/hooks/useClients', () => ({
  useClients: () => ({ data: [{ id: 'c1', name: 'Easy', is_active: true, deleted_at: null }] }),
}));

const createMutate = vi.fn();
vi.mock('@/hooks/usePickupPoints', () => ({
  usePickupPoints: () => ({ data: [] }),
  useCreatePickupPoint: () => ({ mutate: createMutate, isPending: false }),
  useUpdatePickupPoint: () => ({ mutate: vi.fn(), isPending: false }),
}));

describe('PickupPointForm', () => {
  it('renders create form with all fields (all optional)', () => {
    render(<PickupPointForm mode="create" />);
    expect(screen.getByLabelText(/Nombre \(opcional\)/i)).toBeDefined();
    expect(screen.getByLabelText(/Código \(opcional\)/i)).toBeDefined();
    expect(screen.getByLabelText(/Cliente \(opcional\)/i)).toBeDefined();
    expect(screen.getByLabelText('Nombre de ubicación')).toBeDefined();
    expect(screen.getByLabelText('Dirección')).toBeDefined();
  });

  it('submits successfully even when every field is empty', async () => {
    createMutate.mockClear();
    const user = userEvent.setup();
    render(<PickupPointForm mode="create" />);
    await user.click(screen.getByRole('button', { name: /guardar/i }));

    // No validation errors — every field is optional.
    expect(screen.queryByText(/requerido/i)).toBeNull();

    // Mutation called with all undefined values + empty pickup_locations.
    expect(createMutate).toHaveBeenCalledTimes(1);
    const [payload] = createMutate.mock.calls[0];
    expect(payload).toMatchObject({
      name: undefined,
      code: undefined,
      tenant_client_id: undefined,
      pickup_locations: [],
    });
  });

  it('passes only filled-in location fields to the mutation', async () => {
    createMutate.mockClear();
    const user = userEvent.setup();
    render(<PickupPointForm mode="create" />);
    await user.type(screen.getByLabelText(/Nombre \(opcional\)/i), 'Easy Maipú');
    await user.type(screen.getByLabelText('Comuna'), 'Maipú');
    await user.click(screen.getByRole('button', { name: /guardar/i }));

    expect(createMutate).toHaveBeenCalledTimes(1);
    const [payload] = createMutate.mock.calls[0];
    expect(payload).toMatchObject({
      name: 'Easy Maipú',
      code: undefined,
      tenant_client_id: undefined,
      pickup_locations: [{ comuna: 'Maipú' }],
    });
  });
});
