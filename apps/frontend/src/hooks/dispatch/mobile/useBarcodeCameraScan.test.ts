import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBarcodeCameraScan } from './useBarcodeCameraScan';

function defer<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface FakeInstance {
  elementId: string;
  onSuccess: (text: string) => void;
  stop: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  startDeferred: ReturnType<typeof defer<void>>;
}

const instances: FakeInstance[] = [];
const constructorSpy = vi.fn();

vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class {
    elementId: string;
    startDeferred = defer<void>();
    onSuccess: (text: string) => void = () => {};
    stop = vi.fn(() => Promise.resolve());
    clear = vi.fn();
    constructor(elementId: string) {
      this.elementId = elementId;
      constructorSpy(elementId);
      instances.push(this as unknown as FakeInstance);
    }
    start(_cameraConfig: unknown, _scanConfig: unknown, onSuccess: (text: string) => void) {
      this.onSuccess = onSuccess;
      return this.startDeferred.promise;
    }
  },
}));

async function latest(): Promise<FakeInstance> {
  await vi.waitFor(() => expect(instances.length).toBeGreaterThan(0));
  return instances[instances.length - 1];
}

describe('useBarcodeCameraScan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    instances.length = 0;
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
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
    const inst = await latest();
    inst.startDeferred.resolve();
    await vi.waitFor(() => {});
    inst.onSuccess('CL8841881');
    expect(onDecode).toHaveBeenCalledWith('CL8841881');
  });

  it('spec-76 review I3 — never resubmits a code already accepted this session, no matter how much time passes', async () => {
    const onDecode = vi.fn();
    renderHook(() => useBarcodeCameraScan({ active: true, onDecode }));
    const inst = await latest();
    inst.startDeferred.resolve();
    await vi.waitFor(() => {});

    inst.onSuccess('CL8841881');
    inst.onSuccess('CL8841881'); // immediate repeat (label still in frame at ~10fps)
    inst.onSuccess('CL8841881'); // and again — a real 2s-cooldown bug would let this one through
    expect(onDecode).toHaveBeenCalledTimes(1);
  });

  it('spec-76 review I3 — closes the A→B→A hole a single last-decoded slot had', async () => {
    const onDecode = vi.fn();
    renderHook(() => useBarcodeCameraScan({ active: true, onDecode }));
    const inst = await latest();
    inst.startDeferred.resolve();
    await vi.waitFor(() => {});

    inst.onSuccess('A');
    inst.onSuccess('B');
    inst.onSuccess('A'); // A was already accepted this session — must stay suppressed
    expect(onDecode).toHaveBeenCalledTimes(2);
    expect(onDecode).toHaveBeenNthCalledWith(1, 'A');
    expect(onDecode).toHaveBeenNthCalledWith(2, 'B');
  });

  it('spec-76 review I3 — leaving and re-entering camera mode starts a fresh dedupe session', async () => {
    const onDecode = vi.fn();
    const { rerender } = renderHook(
      ({ active }) => useBarcodeCameraScan({ active, onDecode }),
      { initialProps: { active: true } },
    );
    const first = await latest();
    first.startDeferred.resolve();
    await vi.waitFor(() => {});
    first.onSuccess('CL8841881');
    expect(onDecode).toHaveBeenCalledTimes(1);

    rerender({ active: false });
    rerender({ active: true });
    const second = await vi.waitFor(() => {
      expect(instances.length).toBe(2);
      return instances[1];
    });
    second.startDeferred.resolve();
    await vi.waitFor(() => {});
    second.onSuccess('CL8841881'); // same code, but a genuinely new session
    expect(onDecode).toHaveBeenCalledTimes(2);
  });

  it('spec-76 2g #17 — a start failure (denied permission or otherwise) sets cameraError', async () => {
    const { result } = renderHook(() => useBarcodeCameraScan({ active: true, onDecode: vi.fn() }));
    const inst = await latest();
    inst.startDeferred.reject(new Error('Permission denied'));
    await vi.waitFor(() => expect(result.current.cameraError).toBe(true));
  });

  it('unmounts cleanly when stop() throws synchronously', async () => {
    const { unmount } = renderHook(() => useBarcodeCameraScan({ active: true, onDecode: vi.fn() }));
    const inst = await latest();
    inst.stop.mockImplementation(() => {
      throw new Error('Cannot stop, scanner is not running or paused.');
    });
    inst.startDeferred.resolve();
    await vi.waitFor(() => {});
    expect(() => unmount()).not.toThrow();
  });

  it('going from active back to inactive stops the scanner and a later reactivation constructs a new instance', async () => {
    const { rerender } = renderHook(
      ({ active }) => useBarcodeCameraScan({ active, onDecode: vi.fn() }),
      { initialProps: { active: true } },
    );
    const inst = await latest();
    inst.startDeferred.resolve();
    await vi.waitFor(() => {});
    expect(constructorSpy).toHaveBeenCalledTimes(1);

    rerender({ active: false });
    expect(inst.stop).toHaveBeenCalledTimes(1);

    rerender({ active: true });
    await vi.waitFor(() => expect(constructorSpy).toHaveBeenCalledTimes(2));
  });

  it('spec-76 review C2 — a start() that resolves AFTER cleanup already ran stops itself instead of leaking the stream', async () => {
    const { unmount } = renderHook(() => useBarcodeCameraScan({ active: true, onDecode: vi.fn() }));
    const inst = await latest();

    // "Volver al lector" (or a StrictMode double-effect) lands WHILE
    // start() is still in flight — cleanup runs, but the scanner has not
    // finished acquiring the camera yet, so cleanup has nothing to stop.
    unmount();
    expect(inst.stop).not.toHaveBeenCalled();

    // start() now resolves, late. The hook must not leave this holding the
    // camera with nothing referencing it.
    inst.startDeferred.resolve();
    await vi.waitFor(() => expect(inst.stop).toHaveBeenCalledTimes(1));
    expect(inst.clear).toHaveBeenCalled();
  });

  it('spec-76 review I4 — stops the camera when the tab is backgrounded, and restarts it when visible again', async () => {
    renderHook(() => useBarcodeCameraScan({ active: true, onDecode: vi.fn() }));
    const inst = await latest();
    inst.startDeferred.resolve();
    await vi.waitFor(() => {});
    expect(constructorSpy).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(inst.stop).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(constructorSpy).toHaveBeenCalledTimes(2));
  });

  it('spec-76 review I4 — a visibility restart does NOT reset the I3 dedupe set (same session)', async () => {
    const onDecode = vi.fn();
    renderHook(() => useBarcodeCameraScan({ active: true, onDecode }));
    const first = await latest();
    first.startDeferred.resolve();
    await vi.waitFor(() => {});
    first.onSuccess('CL8841881');
    expect(onDecode).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    const second = await vi.waitFor(() => {
      expect(instances.length).toBe(2);
      return instances[1];
    });
    second.startDeferred.resolve();
    await vi.waitFor(() => {});
    second.onSuccess('CL8841881'); // still the same camera session — must stay suppressed
    expect(onDecode).toHaveBeenCalledTimes(1);
  });
});
