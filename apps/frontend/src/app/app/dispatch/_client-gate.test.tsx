import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import DispatchClientGate from './_client-gate';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockUseOperatorId = vi.fn();
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => mockUseOperatorId(),
}));

describe('DispatchClientGate (RBAC)', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it('renders children when user has dispatch permission', () => {
    mockUseOperatorId.mockReturnValue({ permissions: ['dispatch'] });
    render(<DispatchClientGate><div>Dispatch Content</div></DispatchClientGate>);
    expect(screen.getByText('Dispatch Content')).toBeInTheDocument();
  });

  it('renders children when user has admin permission', () => {
    mockUseOperatorId.mockReturnValue({ permissions: ['admin'] });
    render(<DispatchClientGate><div>Dispatch Content</div></DispatchClientGate>);
    expect(screen.getByText('Dispatch Content')).toBeInTheDocument();
  });

  it('redirects to /app/dashboard when user lacks both dispatch and admin', () => {
    mockUseOperatorId.mockReturnValue({ permissions: ['pickup'] });
    render(<DispatchClientGate><div>Dispatch Content</div></DispatchClientGate>);
    expect(mockPush).toHaveBeenCalledWith('/app/dashboard');
    expect(screen.queryByText('Dispatch Content')).not.toBeInTheDocument();
  });

  it('renders children while permissions are loading (empty array)', () => {
    mockUseOperatorId.mockReturnValue({ permissions: [] });
    render(<DispatchClientGate><div>Dispatch Content</div></DispatchClientGate>);
    expect(screen.getByText('Dispatch Content')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
