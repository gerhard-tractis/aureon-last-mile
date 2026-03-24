import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useCameraIntake } from './useCameraIntake';

// ── Supabase mock ────────────────────────────────────────────────────────────
const mockUnsubscribe = vi.fn();
const mockSubscribe = vi.fn().mockReturnValue({ unsubscribe: mockUnsubscribe });
const mockOn = vi.fn().mockReturnThis();
const mockChannel = vi.fn().mockReturnValue({ on: mockOn, subscribe: mockSubscribe });

const mockInsert = vi.fn();
const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert });

const mockUpload = vi.fn();
const mockStorage = { from: vi.fn().mockReturnValue({ upload: mockUpload }) };

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    storage: mockStorage,
    from: mockFrom,
    channel: mockChannel,
  }),
}));

// ── useOperatorId mock ───────────────────────────────────────────────────────
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-123' }),
}));

// ── helpers ──────────────────────────────────────────────────────────────────
const makeFile = (name = 'photo.jpg') => new File(['data'], name, { type: 'image/jpeg' });

describe('useCameraIntake', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpload.mockResolvedValue({ error: null });
    mockInsert.mockResolvedValue({ error: null });
    mockOn.mockImplementation((_event: string, _filter: unknown, cb: (payload: unknown) => void) => {
      // Simulate realtime update after subscribe
      setTimeout(() => cb({ new: { status: 'parsed', orders_created: 5 } }), 0);
      return { on: mockOn, subscribe: mockSubscribe };
    });
  });

  it('starts in idle state', () => {
    const { result } = renderHook(() => useCameraIntake());
    expect(result.current.status).toBe('idle');
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('transitions to uploading then processing on submit', async () => {
    const { result } = renderHook(() => useCameraIntake());
    const file = makeFile();

    await act(async () => {
      await result.current.submit(file, 'gen-1');
    });

    expect(mockUpload).toHaveBeenCalledOnce();
    expect(mockInsert).toHaveBeenCalledOnce();
  });

  it('passes operator_id and generator_id to insert', async () => {
    const { result } = renderHook(() => useCameraIntake());
    await act(async () => {
      await result.current.submit(makeFile(), 'gen-abc');
    });

    expect(mockFrom).toHaveBeenCalledWith('intake_submissions');
    const insertArg = mockInsert.mock.calls[0][0];
    expect(insertArg.operator_id).toBe('op-123');
    expect(insertArg.generator_id).toBe('gen-abc');
    expect(insertArg.channel).toBe('mobile_camera');
  });

  it('sets error state when upload fails', async () => {
    mockUpload.mockResolvedValue({ error: { message: 'upload failed' } });
    const { result } = renderHook(() => useCameraIntake());

    await act(async () => {
      await result.current.submit(makeFile(), 'gen-1');
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('upload failed');
  });

  it('sets error state when insert fails', async () => {
    mockInsert.mockResolvedValue({ error: { message: 'insert failed' } });
    const { result } = renderHook(() => useCameraIntake());

    await act(async () => {
      await result.current.submit(makeFile(), 'gen-1');
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('insert failed');
  });

  it('reset() returns hook to idle', async () => {
    mockUpload.mockResolvedValue({ error: { message: 'oops' } });
    const { result } = renderHook(() => useCameraIntake());

    await act(async () => {
      await result.current.submit(makeFile(), 'gen-1');
    });
    expect(result.current.status).toBe('error');

    act(() => result.current.reset());
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
  });

  it('transitions to success when realtime emits parsed status', async () => {
    const { result } = renderHook(() => useCameraIntake());

    await act(async () => {
      await result.current.submit(makeFile(), 'gen-1');
      // flush the setTimeout from mockOn
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(result.current.status).toBe('success');
    expect(result.current.result?.ordersCreated).toBe(5);
  });
});
