import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock supabase client
let capturedSubscribeCallback: ((status: string) => void) | null = null;

const mockSubscribe = vi.fn().mockImplementation((cb: (status: string) => void) => {
  capturedSubscribeCallback = cb;
  return {};
});
const mockOn = vi.fn().mockReturnThis();
const mockChannel = vi.fn().mockReturnValue({
  on: mockOn,
  subscribe: mockSubscribe,
});
const mockRemoveChannel = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    channel: mockChannel,
    removeChannel: mockRemoveChannel,
  }),
}));

import { useRealtimeStatus } from './useRealtimeStatus';

describe('useRealtimeStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    capturedSubscribeCallback = null;
    mockOn.mockReturnThis();
    mockSubscribe.mockImplementation((cb: (status: string) => void) => {
      capturedSubscribeCallback = cb;
      return {};
    });
    mockChannel.mockReturnValue({ on: mockOn, subscribe: mockSubscribe });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initial status is disconnected', () => {
    const { result } = renderHook(() => useRealtimeStatus());
    expect(result.current).toBe('disconnected');
  });

  it('status becomes connected when subscribe callback fires with SUBSCRIBED', () => {
    const { result } = renderHook(() => useRealtimeStatus());

    expect(result.current).toBe('disconnected');

    act(() => {
      capturedSubscribeCallback?.('SUBSCRIBED');
    });

    expect(result.current).toBe('connected');
  });

  it('removes channel on unmount', () => {
    const { unmount } = renderHook(() => useRealtimeStatus());
    unmount();
    expect(mockRemoveChannel).toHaveBeenCalled();
  });
});
