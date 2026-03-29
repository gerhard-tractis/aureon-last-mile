import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useCameraIntake } from './useCameraIntake';

// ── Supabase mock ────────────────────────────────────────────────────────────
const mockUnsubscribe = vi.fn();
const mockSubscribe = vi.fn().mockReturnValue({ unsubscribe: mockUnsubscribe });
const mockOn = vi.fn().mockReturnThis();
const mockChannel = vi.fn().mockReturnValue({ on: mockOn, subscribe: mockSubscribe });

const mockSingle = vi.fn();
const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });
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
    mockSingle.mockResolvedValue({ data: { id: 'sub-1' }, error: null });
    mockSelect.mockReturnValue({ single: mockSingle });
    mockInsert.mockReturnValue({ select: mockSelect });
    mockFrom.mockReturnValue({ insert: mockInsert });
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
    expect(result.current.uploadProgress).toBeNull();
  });

  it('transitions to uploading then processing on submit', async () => {
    const { result } = renderHook(() => useCameraIntake());
    const file = makeFile();

    await act(async () => {
      await result.current.submit([file], 'pp-1');
    });

    expect(mockUpload).toHaveBeenCalledOnce();
    expect(mockInsert).toHaveBeenCalledOnce();
  });

  it('uploads multiple files sequentially', async () => {
    const { result } = renderHook(() => useCameraIntake());
    const files = [makeFile('page1.jpg'), makeFile('page2.jpg'), makeFile('page3.jpg')];

    await act(async () => {
      await result.current.submit(files, 'pp-1');
    });

    expect(mockUpload).toHaveBeenCalledTimes(3);
    // Verify sequential: each call uses the correct page path
    const calls = mockUpload.mock.calls;
    expect(calls[0][0]).toMatch(/page-1\.jpg$/);
    expect(calls[1][0]).toMatch(/page-2\.jpg$/);
    expect(calls[2][0]).toMatch(/page-3\.jpg$/);
  });

  it('passes operator_id and pickup_point_id to insert', async () => {
    const { result } = renderHook(() => useCameraIntake());
    await act(async () => {
      await result.current.submit([makeFile()], 'pp-abc');
    });

    expect(mockFrom).toHaveBeenCalledWith('intake_submissions');
    const insertArg = mockInsert.mock.calls[0][0];
    expect(insertArg.operator_id).toBe('op-123');
    expect(insertArg.pickup_point_id).toBe('pp-abc');
    expect(insertArg.channel).toBe('mobile_camera');
    expect(insertArg.raw_payload.file_count).toBe(1);
  });

  it('does not use generator_id in insert payload', async () => {
    const { result } = renderHook(() => useCameraIntake());
    await act(async () => {
      await result.current.submit([makeFile()], 'pp-abc');
    });

    const insertArg = mockInsert.mock.calls[0][0];
    expect(insertArg).not.toHaveProperty('generator_id');
  });

  it('sets error state when upload fails', async () => {
    mockUpload.mockResolvedValue({ error: { message: 'upload failed' } });
    const { result } = renderHook(() => useCameraIntake());

    await act(async () => {
      await result.current.submit([makeFile()], 'pp-1');
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('upload failed');
  });

  it('sets error state when insert fails', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'insert failed' } });
    const { result } = renderHook(() => useCameraIntake());

    await act(async () => {
      await result.current.submit([makeFile()], 'pp-1');
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('insert failed');
  });

  it('reset() returns hook to idle and clears uploadProgress', async () => {
    mockUpload.mockResolvedValue({ error: { message: 'oops' } });
    const { result } = renderHook(() => useCameraIntake());

    await act(async () => {
      await result.current.submit([makeFile()], 'pp-1');
    });
    expect(result.current.status).toBe('error');

    act(() => result.current.reset());
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(result.current.uploadProgress).toBeNull();
  });

  it('transitions to success when realtime emits parsed status', async () => {
    const { result } = renderHook(() => useCameraIntake());

    await act(async () => {
      await result.current.submit([makeFile()], 'pp-1');
      // flush the setTimeout from mockOn
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(result.current.status).toBe('success');
    expect(result.current.result?.ordersCreated).toBe(5);
  });

  it('uses submission ID in realtime filter', async () => {
    const { result } = renderHook(() => useCameraIntake());

    await act(async () => {
      await result.current.submit([makeFile()], 'pp-1');
    });

    // Channel name should include submission ID
    expect(mockChannel).toHaveBeenCalledWith('intake:sub-1');
    // Filter should use id=eq.sub-1
    const onCall = mockOn.mock.calls[0];
    expect(onCall[1]).toMatchObject({ filter: 'id=eq.sub-1' });
  });

  it('does not submit when files array is empty', async () => {
    const { result } = renderHook(() => useCameraIntake());

    await act(async () => {
      await result.current.submit([], 'pp-1');
    });

    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });
});
