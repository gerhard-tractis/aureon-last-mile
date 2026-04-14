import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClientForm } from './ClientForm';

vi.mock('@/lib/stores/clientStore', () => ({
  useClientStore: () => ({
    isCreateFormOpen: true,
    isEditFormOpen: false,
    selectedClientId: null,
    setCreateFormOpen: vi.fn(),
    setEditFormOpen: vi.fn(),
  }),
}));

vi.mock('@/hooks/useClients', () => ({
  useClients: () => ({ data: [] }),
  useCreateClient: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateClient: () => ({ mutate: vi.fn(), isPending: false }),
}));

describe('ClientForm', () => {
  it('renders create form with name field', () => {
    render(<ClientForm mode="create" />);
    expect(screen.getByLabelText('Nombre')).toBeDefined();
  });

  it('validates name is required on submit', async () => {
    const user = userEvent.setup();
    render(<ClientForm mode="create" />);
    const submitBtn = screen.getByRole('button', { name: /guardar/i });
    await user.click(submitBtn);
    expect(screen.getByText(/el nombre es requerido/i)).toBeDefined();
  });
});
