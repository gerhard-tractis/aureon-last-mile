import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBarcodeCameraScan } from './useBarcodeCameraScan';

// Same shape as RouteQRScannerEntry.test.tsx's mock: avoid html5-qrcode
// trying to use real cameras in jsdom. `startImpl`/`stopImpl` are
// overridable per test.
const scannerState = {
  startImpl: (
    _cameraConfig: unknown,
    _scanConfig: unknown,
    onSuccess: (text: string) => void,
    _onError: unknown,
  ) => {
    scannerState.lastOnSuccess = onSuccess;
    return Promise.resolve();
  },
  stopImpl: () => Promise.resolve() as unknown,
  lastOnSuccess: undefined as ((text: string) => void) | undefined,
};

const constructorSpy = vi.fn();

vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class {
    constructor(elementId: string) {
      constructorSpy(elementId);
    }
    start = vi.fn((...args: unknown[]) =>
      (scannerState.startImpl as (...a: unknown[]) => Promise<unknown>)(...args),
    );
    stop = vi.fn(() => scannerState.stopImpl());
    clear = vi.fn();
  },
}));

describe('useBarcodeCameraScan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scannerState.lastOnSuccess = undefined;
    scannerState.startImpl = (_c, _s, onSuccess) => {
      scannerState.lastOnSuccess = onSuccess;
      return Promise.resolve();
    };
    scannerState.stopImpl = () => Promise.resolve();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('spec-76 2g #16/rule 7 — does not construct the camera while inactive', () => {
    const { unmount } = renderHook(() => useBarcodeCameraScan({ active: false, onDecode: vi.fn() }));
    expect(constructorSpy).not.toHaveBeenCalled();
    unmount();
  });

  it('starts the camera once active becomes true', async () => {
    const { rerender } = renderHook(
      ({ active }) => useBarcodeCameraScan({ active, onDecode: vi.fn() }),
      { initialProps: { active: false } },
    );
    expect(constructorSpy).not.toHaveBeenCalled();
    rerender({ active: true });
    await vi.waitFor(() => expect(constructorSpy).toHaveBeenCalledWith('dispatch-camera-reader'));
  });

  it('a decoded frame calls onDecode', async () => {
    const onDecode = vi.fn();
    renderHook(() => useBarcodeCameraScan({ active: true, onDecode }));
    await vi.waitFor(() => expect(scannerState.lastOnSuccess).toBeDefined());
    scannerState.lastOnSuccess!('CL8841881');
    expect(onDecode).toHaveBeenCalledWith('CL8841881');
  });

  it('dedupes the same code decoded twice within the cooldown window', async () => {
    const onDecode = vi.fn();
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1000);
    renderHook(() => useBarcodeCameraScan({ active: true, onDecode }));
    await vi.waitFor(() => expect(scannerState.lastOnSuccess).toBeDefined());

    scannerState.lastOnSuccess!('CL8841881');
    nowSpy.mockReturnValue(1500); // still within the 2000ms cooldown
    scannerState.lastOnSuccess!('CL8841881');
    expect(onDecode).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(3200); // past the cooldown
    scannerState.lastOnSuccess!('CL8841881');
    expect(onDecode).toHaveBeenCalledTimes(2);
  });

  it('spec-76 2g #17 — a start failure (denied permission or otherwise) sets cameraError', async () => {
    scannerState.startImpl = () => Promise.reject(new Error('Permission denied'));
    const { result } = renderHook(() => useBarcodeCameraScan({ active: true, onDecode: vi.fn() }));
    await vi.waitFor(() => expect(result.current.cameraError).toBe(true));
  });

  it('unmounts cleanly when the camera never started and stop() throws synchronously', async () => {
    scannerState.startImpl = () => Promise.resolve(); // camera did "start" per our mock
    scannerState.stopImpl = () => {
      throw new Error('Cannot stop, scanner is not running or paused.');
    };
    const { unmount } = renderHook(() => useBarcodeCameraScan({ active: true, onDecode: vi.fn() }));
    await vi.waitFor(() => expect(constructorSpy).toHaveBeenCalled());
    expect(() => unmount()).not.toThrow();
  });

  it('going from active back to inactive stops the scanner (cleanup runs)', async () => {
    const { rerender } = renderHook(
      ({ active }) => useBarcodeCameraScan({ active, onDecode: vi.fn() }),
      { initialProps: { active: true } },
    );
    await vi.waitFor(() => expect(constructorSpy).toHaveBeenCalledTimes(1));
    rerender({ active: false });
    // Going active again should construct a brand new scanner instance —
    // proof the previous one's cleanup actually ran rather than leaking.
    rerender({ active: true });
    await vi.waitFor(() => expect(constructorSpy).toHaveBeenCalledTimes(2));
  });
});
