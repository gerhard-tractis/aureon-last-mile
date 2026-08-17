import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockState = {
  status: 'online' as 'online' | 'offline' | 'syncing',
  queuedCount: 0,
  recent: [],
  retryNow: vi.fn(),
  isRetrying: false,
};

vi.mock('@/hooks/useSyncQueue', () => ({
  useSyncQueue: () => mockState,
}));

import { SyncChip } from './SyncChip';

beforeEach(() => {
  mockState.status = 'online';
  mockState.queuedCount = 0;
});

describe('SyncChip', () => {
  it('renders nothing when online with an empty queue', () => {
    // The normal state needs no chrome; the old banner shipped one anyway.
    const { container } = render(<SyncChip />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says how much work is held when offline, not just that the link is down', () => {
    mockState.status = 'offline';
    mockState.queuedCount = 14;
    render(<SyncChip />);
    expect(screen.getByText('SIN CONEXIÓN · 14 EN COLA')).toBeInTheDocument();
  });

  it('still reports a backlog while online', () => {
    mockState.queuedCount = 3;
    render(<SyncChip />);
    expect(screen.getByText('3 EN COLA')).toBeInTheDocument();
  });

  it('announces itself politely rather than interrupting', () => {
    mockState.status = 'offline';
    mockState.queuedCount = 1;
    render(<SyncChip />);
    const chip = screen.getByTestId('sync-chip');
    expect(chip).toHaveAttribute('role', 'status');
    expect(chip).toHaveAttribute('aria-live', 'polite');
  });

  it('shows a syncing state while the queue drains', () => {
    mockState.status = 'syncing';
    mockState.queuedCount = 2;
    render(<SyncChip />);
    expect(screen.getByText('SINCRONIZANDO…')).toBeInTheDocument();
  });
});
