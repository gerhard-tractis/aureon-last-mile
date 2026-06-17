import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReceptionClientGate from './_client-gate';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockUseOperatorId = vi.fn();
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => mockUseOperatorId(),
}));

describe('ReceptionClientGate (RBAC)', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it('renders children when user has reception permission', () => {
    mockUseOperatorId.mockReturnValue({ permissions: ['reception'] });
    render(<ReceptionClientGate><div>Reception Content</div></ReceptionClientGate>);
    expect(screen.getByText('Reception Content')).toBeInTheDocument();
  });

  it('redirects to /app when user lacks reception permission', () => {
    mockUseOperatorId.mockReturnValue({ permissions: ['pickup'] });
    render(<ReceptionClientGate><div>Reception Content</div></ReceptionClientGate>);
    expect(mockPush).toHaveBeenCalledWith('/app');
    expect(screen.queryByText('Reception Content')).not.toBeInTheDocument();
  });

  it('renders children while permissions are loading (empty array)', () => {
    mockUseOperatorId.mockReturnValue({ permissions: [] });
    render(<ReceptionClientGate><div>Reception Content</div></ReceptionClientGate>);
    expect(screen.getByText('Reception Content')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('allows admin users with reception permission', () => {
    mockUseOperatorId.mockReturnValue({ permissions: ['admin', 'reception'] });
    render(<ReceptionClientGate><div>Admin Reception</div></ReceptionClientGate>);
    expect(screen.getByText('Admin Reception')).toBeInTheDocument();
  });
});
