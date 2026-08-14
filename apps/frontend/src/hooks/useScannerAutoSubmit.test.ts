import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScannerAutoSubmit } from './useScannerAutoSubmit';

afterEach(() => {
  vi.useRealTimers();
});

function typeBurst(
  handleValueChange: (v: string) => void,
  code: string,
  msPerChar: number
) {
  for (let i = 1; i <= code.length; i++) {
    handleValueChange(code.slice(0, i));
    act(() => vi.advanceTimersByTime(msPerChar));
  }
}

describe('useScannerAutoSubmit', () => {
  it('submits a realistic scanner burst (25 ms/char) after the idle window', () => {
    vi.useFakeTimers();
    const onSubmit = vi.fn();
    const { result } = renderHook(() => useScannerAutoSubmit(onSubmit));

    typeBurst(result.current.handleValueChange, 'CTN1234567', 25);
    act(() => vi.advanceTimersByTime(120));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('CTN1234567');
  });

  it('submits an instantaneous burst (all changes in the same tick)', () => {
    vi.useFakeTimers();
    const onSubmit = vi.fn();
    const { result } = renderHook(() => useScannerAutoSubmit(onSubmit));

    typeBurst(result.current.handleValueChange, 'CTN12345', 0);
    act(() => vi.advanceTimersByTime(130));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('CTN12345');
  });

  it('does not submit human-speed typing (gaps over 100 ms)', () => {
    vi.useFakeTimers();
    const onSubmit = vi.fn();
    const { result } = renderHook(() => useScannerAutoSubmit(onSubmit));

    typeBurst(result.current.handleValueChange, 'ABC1234', 250);
    act(() => vi.advanceTimersByTime(500));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not submit codes shorter than the minimum length', () => {
    vi.useFakeTimers();
    const onSubmit = vi.fn();
    const { result } = renderHook(() => useScannerAutoSubmit(onSubmit));

    typeBurst(result.current.handleValueChange, 'A12', 10);
    act(() => vi.advanceTimersByTime(200));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('reset() cancels a pending auto-submit (Enter already handled it)', () => {
    vi.useFakeTimers();
    const onSubmit = vi.fn();
    const { result } = renderHook(() => useScannerAutoSubmit(onSubmit));

    typeBurst(result.current.handleValueChange, 'CTN12345', 10);
    result.current.reset();
    act(() => vi.advanceTimersByTime(500));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('clearing the input resets gap tracking so the next burst is judged fresh', () => {
    vi.useFakeTimers();
    const onSubmit = vi.fn();
    const { result } = renderHook(() => useScannerAutoSubmit(onSubmit));

    // Human-speed fragment, then cleared
    typeBurst(result.current.handleValueChange, 'AB', 300);
    result.current.handleValueChange('');

    // Fresh scanner burst must submit despite the earlier slow gaps
    typeBurst(result.current.handleValueChange, 'CTN12345', 20);
    act(() => vi.advanceTimersByTime(120));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('CTN12345');
  });

  it('uses the latest onSubmit callback (no stale closure)', () => {
    vi.useFakeTimers();
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(
      ({ cb }: { cb: (v: string) => void }) => useScannerAutoSubmit(cb),
      { initialProps: { cb: first } }
    );

    typeBurst(result.current.handleValueChange, 'CTN12345', 10);
    rerender({ cb: second });
    act(() => vi.advanceTimersByTime(120));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('CTN12345');
  });

  it('clears the pending timer on unmount', () => {
    vi.useFakeTimers();
    const onSubmit = vi.fn();
    const { result, unmount } = renderHook(() => useScannerAutoSubmit(onSubmit));

    typeBurst(result.current.handleValueChange, 'CTN12345', 10);
    unmount();
    act(() => vi.advanceTimersByTime(500));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
