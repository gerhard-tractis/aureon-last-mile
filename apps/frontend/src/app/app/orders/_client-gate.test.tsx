import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import OrdersClientGate from './_client-gate';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockUseOperatorId = vi.fn();
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => mockUseOperatorId(),
}));

describe('OrdersClientGate (RBAC)', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it('renders children for role admin', () => {
    mockUseOperatorId.mockReturnValue({ role: 'admin', permissions: ['admin'] });
    render(<OrdersClientGate><div>Orders Content</div></OrdersClientGate>);
    expect(screen.getByText('Orders Content')).toBeInTheDocument();
  });

  it('renders children for role operations_manager', () => {
    mockUseOperatorId.mockReturnValue({ role: 'operations_manager', permissions: ['pickup'] });
    render(<OrdersClientGate><div>Orders Content</div></OrdersClientGate>);
    expect(screen.getByText('Orders Content')).toBeInTheDocument();
  });

  it('renders children for a non-manager role that carries the customer_service permission', () => {
    mockUseOperatorId.mockReturnValue({ role: 'pickup_crew', permissions: ['customer_service'] });
    render(<OrdersClientGate><div>Orders Content</div></OrdersClientGate>);
    expect(screen.getByText('Orders Content')).toBeInTheDocument();
  });

  it('redirects to /app/dashboard when the role is neither admin/operations_manager nor customer_service', () => {
    mockUseOperatorId.mockReturnValue({ role: 'pickup_crew', permissions: ['pickup'] });
    render(<OrdersClientGate><div>Orders Content</div></OrdersClientGate>);
    expect(mockPush).toHaveBeenCalledWith('/app/dashboard');
    expect(screen.queryByText('Orders Content')).not.toBeInTheDocument();
  });

  it('renders children while permissions are still loading (empty array)', () => {
    mockUseOperatorId.mockReturnValue({ role: null, permissions: [] });
    render(<OrdersClientGate><div>Orders Content</div></OrdersClientGate>);
    expect(screen.getByText('Orders Content')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
