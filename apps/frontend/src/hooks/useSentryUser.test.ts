import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as Sentry from '@sentry/nextjs';
import { useSentryUser } from './useSentryUser';

// Mock Sentry
vi.mock('@sentry/nextjs', () => ({
  setUser: vi.fn(),
}));

// Mock Supabase client
const mockGetSession = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: vi.fn(() => ({
    auth: {
      getSession: mockGetSession,
      onAuthStateChange: vi.fn((callback) => {
        // Store callback for manual triggering in tests
        (global as any).__authCallback = callback;
        return {
          data: { subscription: { unsubscribe: vi.fn() } },
        };
      }),
    },
  })),
}));

describe('useSentryUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global as any).__authCallback = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should set Sentry user context when user is authenticated', async () => {
    const mockUser = {
      id: 'user-123',
      email: 'test@example.com',
      user_metadata: {
        full_name: 'Test User',
      },
      app_metadata: {
        operator_id: 'op-456',
        claims: {
          role: 'driver',
        },
      },
    };

    mockGetSession.mockResolvedValue({
      data: {
        session: { user: mockUser },
      },
      error: null,
    });

    renderHook(() => useSentryUser());

    // Wait for effect to run
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(Sentry.setUser).toHaveBeenCalledWith({
      id: 'user-123',
      email: 'test@example.com',
      username: 'Test User',
      operator_id: 'op-456',
      role: 'driver',
    });
  });

  it('should clear Sentry user context when user logs out', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    renderHook(() => useSentryUser());

    // Wait for effect to run
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(Sentry.setUser).toHaveBeenCalledWith(null);
  });

  it('should update Sentry user on auth state change', async () => {
    const mockUser = {
      id: 'user-789',
      email: 'newuser@example.com',
      user_metadata: {
        full_name: 'New User',
      },
      app_metadata: {
        operator_id: 'op-999',
        claims: {
          role: 'admin',
        },
      },
    };

    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    renderHook(() => useSentryUser());

    // Simulate auth state change
    if ((global as any).__authCallback) {
      (global as any).__authCallback('SIGNED_IN', { user: mockUser });
    }

    // Wait for callback to process
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(Sentry.setUser).toHaveBeenCalledWith({
      id: 'user-789',
      email: 'newuser@example.com',
      username: 'New User',
      operator_id: 'op-999',
      role: 'admin',
    });
  });

  it('should handle missing user metadata gracefully', async () => {
    const mockUser = {
      id: 'user-minimal',
      email: 'minimal@example.com',
      user_metadata: {},
      app_metadata: {},
    };

    mockGetSession.mockResolvedValue({
      data: {
        session: { user: mockUser },
      },
      error: null,
    });

    renderHook(() => useSentryUser());

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(Sentry.setUser).toHaveBeenCalledWith({
      id: 'user-minimal',
      email: 'minimal@example.com',
      username: undefined,
      operator_id: undefined,
      role: undefined,
    });
  });
});
