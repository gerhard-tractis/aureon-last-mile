import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import PickupClientGate from './_client-gate';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockUseOperatorId = vi.fn();
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => mockUseOperatorId(),
}));

describe('PickupClientGate (RBAC)', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it('renders children when user has pickup permission', () => {
    mockUseOperatorId.mockReturnValue({ permissions: ['pickup'] });
    render(<PickupClientGate><div>Pickup Content</div></PickupClientGate>);
    expect(screen.getByText('Pickup Content')).toBeInTheDocument();
  });

  it('redirects to /app when user lacks pickup permission', () => {
    mockUseOperatorId.mockReturnValue({ permissions: ['reception'] });
    render(<PickupClientGate><div>Pickup Content</div></PickupClientGate>);
    expect(mockPush).toHaveBeenCalledWith('/app');
    expect(screen.queryByText('Pickup Content')).not.toBeInTheDocument();
  });

  it('renders children while permissions are loading (empty array)', () => {
    mockUseOperatorId.mockReturnValue({ permissions: [] });
    render(<PickupClientGate><div>Pickup Content</div></PickupClientGate>);
    expect(screen.getByText('Pickup Content')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
