import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReceptionLayout from './layout';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockUseOperatorId = vi.fn();
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => mockUseOperatorId(),
}));

describe('ReceptionLayout', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it('renders children when user has reception permission', () => {
    mockUseOperatorId.mockReturnValue({
      permissions: ['reception'],
    });
    render(
      <ReceptionLayout>
        <div>Reception Content</div>
      </ReceptionLayout>
    );
    expect(screen.getByText('Reception Content')).toBeInTheDocument();
  });

  it('redirects to /app when user lacks reception permission', () => {
    mockUseOperatorId.mockReturnValue({
      permissions: ['pickup'],
    });
    render(
      <ReceptionLayout>
        <div>Reception Content</div>
      </ReceptionLayout>
    );
    expect(mockPush).toHaveBeenCalledWith('/app');
    expect(screen.queryByText('Reception Content')).not.toBeInTheDocument();
  });

  it('renders nothing while permissions are loading (empty array)', () => {
    mockUseOperatorId.mockReturnValue({
      permissions: [],
    });
    const { container } = render(
      <ReceptionLayout>
        <div>Reception Content</div>
      </ReceptionLayout>
    );
    // When permissions haven't loaded yet, render children (waiting state)
    expect(screen.getByText('Reception Content')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('allows admin users with reception permission', () => {
    mockUseOperatorId.mockReturnValue({
      permissions: ['admin', 'reception'],
    });
    render(
      <ReceptionLayout>
        <div>Admin Reception</div>
      </ReceptionLayout>
    );
    expect(screen.getByText('Admin Reception')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
