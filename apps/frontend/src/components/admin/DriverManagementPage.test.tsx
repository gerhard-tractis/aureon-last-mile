/**
 * DriverManagementPage Component Tests — spec-84 fase 1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DriverManagementPage } from './DriverManagementPage';
import type { Driver } from '@/lib/api/drivers';
import type { User } from '@/lib/api/users';

const mockMutate = vi.fn();

vi.mock('@/hooks/useDrivers', () => ({
  useDrivers: vi.fn(),
  useLinkDriverUser: vi.fn(() => ({ mutate: mockMutate, isPending: false })),
}));

vi.mock('@/hooks/useUsers', () => ({
  useUsers: vi.fn(),
}));

import { useDrivers } from '@/hooks/useDrivers';
import { useUsers } from '@/hooks/useUsers';

describe('DriverManagementPage', () => {
  const linkedUser: User = {
    id: 'u1', email: 'qa-pickup-crew@qa.test', full_name: 'QA Pickup Crew', role: 'pickup_crew',
    permissions: [], operator_id: 'op-1', created_at: '2026-01-01T00:00:00Z', deleted_at: null,
  };
  const otherUser: User = {
    id: 'u2', email: 'qa-admin@qa.test', full_name: 'QA Admin', role: 'admin',
    permissions: [], operator_id: 'op-1', created_at: '2026-01-01T00:00:00Z', deleted_at: null,
  };
  const drivers: Driver[] = [
    {
      id: 'd1', operator_id: 'op-1', full_name: 'Driver Uno', phone: '+56911111101',
      rut: '11.111.111-1', fleet_type: 'own', status: 'active',
      user_id: 'u1', users: { id: 'u1', email: linkedUser.email, full_name: linkedUser.full_name },
    },
    {
      id: 'd2', operator_id: 'op-1', full_name: 'Driver Dos', phone: '+56911111102',
      rut: '22.222.222-2', fleet_type: 'external', status: 'active',
      user_id: null, users: null,
    },
  ];

  beforeEach(() => {
    mockMutate.mockReset();
    vi.mocked(useDrivers).mockReturnValue({ data: drivers, isLoading: false } as never);
    vi.mocked(useUsers).mockReturnValue({ data: [linkedUser, otherUser], isLoading: false } as never);
  });

  it('renders every driver with its linked user, or "Sin vincular"', () => {
    render(<DriverManagementPage />);

    expect(screen.getByText('Driver Uno')).toBeInTheDocument();
    expect(screen.getByText('Driver Dos')).toBeInTheDocument();
    expect(screen.getAllByText('Sin vincular')).toHaveLength(1);
  });

  it('links an unlinked driver to a chosen user', () => {
    render(<DriverManagementPage />);

    const selects = screen.getAllByRole('combobox');
    // Driver Dos (unlinked) is the second row's select.
    fireEvent.change(selects[1], { target: { value: 'u2' } });

    expect(mockMutate).toHaveBeenCalledWith({ driverId: 'd2', userId: 'u2' });
  });

  it('unlinks a driver by choosing the empty option', () => {
    render(<DriverManagementPage />);

    const selects = screen.getAllByRole('combobox');
    // Driver Uno (linked to u1) is the first row's select.
    fireEvent.change(selects[0], { target: { value: '' } });

    expect(mockMutate).toHaveBeenCalledWith({ driverId: 'd1', userId: null });
  });
});
