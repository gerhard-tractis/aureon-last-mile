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

vi.mock('@/hooks/usePickupPoints', () => ({
  usePickupPoints: () => ({ data: [] }),
  useCreatePickupPoint: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdatePickupPoint: () => ({ mutate: vi.fn(), isPending: false }),
}));

describe('PickupPointForm', () => {
  it('renders create form with all required fields', () => {
    render(<PickupPointForm mode="create" />);
    expect(screen.getByLabelText('Nombre')).toBeDefined();
    expect(screen.getByLabelText('Código')).toBeDefined();
    expect(screen.getByLabelText('Cliente')).toBeDefined();
    expect(screen.getByLabelText('Nombre de ubicación')).toBeDefined();
    expect(screen.getByLabelText('Dirección')).toBeDefined();
  });

  it('validates required fields on submit', async () => {
    const user = userEvent.setup();
    render(<PickupPointForm mode="create" />);
    await user.click(screen.getByRole('button', { name: /guardar/i }));
    expect(screen.getByText(/el nombre es requerido/i)).toBeDefined();
  });
});
