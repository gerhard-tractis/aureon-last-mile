// apps/frontend/src/app/app/distribution/layout.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import DistributionLayout from './layout';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockUseOperatorId = vi.fn();
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => mockUseOperatorId(),
}));

describe('DistributionLayout', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it('renders children when user has distribution permission', () => {
    mockUseOperatorId.mockReturnValue({ permissions: ['distribution'] });
    render(<DistributionLayout><div>Distribution Content</div></DistributionLayout>);
    expect(screen.getByText('Distribution Content')).toBeInTheDocument();
  });

  it('redirects to /app when user lacks distribution permission', () => {
    mockUseOperatorId.mockReturnValue({ permissions: ['pickup'] });
    render(<DistributionLayout><div>Distribution Content</div></DistributionLayout>);
    expect(mockPush).toHaveBeenCalledWith('/app');
    expect(screen.queryByText('Distribution Content')).not.toBeInTheDocument();
  });

  it('renders children while permissions loading (empty array)', () => {
    mockUseOperatorId.mockReturnValue({ permissions: [] });
    render(<DistributionLayout><div>Distribution Content</div></DistributionLayout>);
    expect(screen.getByText('Distribution Content')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('allows admin users with distribution permission', () => {
    mockUseOperatorId.mockReturnValue({ permissions: ['admin', 'distribution'] });
    render(<DistributionLayout><div>Admin Distribution</div></DistributionLayout>);
    expect(screen.getByText('Admin Distribution')).toBeInTheDocument();
  });
});
