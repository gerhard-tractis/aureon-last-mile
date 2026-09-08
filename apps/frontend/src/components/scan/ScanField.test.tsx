import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScanField } from './ScanField';

afterEach(() => {
  vi.useRealTimers();
});

describe('ScanField', () => {
  it('auto-submits a realistic scanner burst with no Enter suffix', () => {
    vi.useFakeTimers();
    const onScan = vi.fn();
    render(<ScanField onScan={onScan} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;

    // Real keyboard-wedge scanners emit ~15–50 ms per character and many are
    // not configured to send a CR/Enter terminator.
    const code = 'CL7742891003';
    for (let i = 1; i <= code.length; i++) {
      fireEvent.change(input, { target: { value: code.slice(0, i) } });
      act(() => vi.advanceTimersByTime(25));
    }
    act(() => vi.advanceTimersByTime(120));

    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith(code);
    expect(input.value).toBe('');
  });

  it('does not auto-submit human-speed typing', () => {
    vi.useFakeTimers();
    const onScan = vi.fn();
    render(<ScanField onScan={onScan} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;

    const code = 'CL774289';
    for (let i = 1; i <= code.length; i++) {
      fireEvent.change(input, { target: { value: code.slice(0, i) } });
      act(() => vi.advanceTimersByTime(300));
    }
    act(() => vi.advanceTimersByTime(500));

    expect(onScan).not.toHaveBeenCalled();
    expect(input.value).toBe(code);
  });

  it('does not double-fire when Enter arrives at the end of a burst', () => {
    vi.useFakeTimers();
    const onScan = vi.fn();
    render(<ScanField onScan={onScan} />);
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'CL7742891003' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    act(() => vi.advanceTimersByTime(500));

    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it('does not double-submit when Enter arrives after the debounce already auto-submitted (spec-54 race)', () => {
    // Reproduces the production race: the Zebra/keyboard-wedge path fills the
    // whole value in one shot (maxKeyGap = 0), so the auto-submit timer is
    // armed. If the gap before the trailing Enter keystroke exceeds
    // IDLE_DEBOUNCE_MS (120ms) — plausible under load, e.g. two separate
    // Playwright round trips — the timer fires and submits BEFORE Enter's
    // keydown handler runs. The debounce fire schedules a React state update
    // (setValue('')) that is not yet committed when the real Enter keydown
    // event is dispatched, so the still-attached handler closure can see the
    // stale (uncommitted) value and submit the same code a second time.
    vi.useFakeTimers();
    const onScan = vi.fn();
    render(<ScanField onScan={onScan} />);
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'E2E78-P1B' } });
    // Advance past the debounce window WITHOUT act() — this fires the
    // setTimeout callback (which calls setValue('')) but does not force
    // React to flush/commit that update before the next line runs, mirroring
    // the real gap between the browser-side timer firing and the DOM commit
    // versus the next real keyboard event arriving from Playwright. Prints
    // "An update ... was not wrapped in act(...)" to stderr on every run —
    // that's the point, not a leak to clean up: this test depends on RTL not
    // auto-flushing outside act(), which is true today (mutating the fix
    // this test guards makes it fail) but isn't guaranteed by any contract.
    vi.advanceTimersByTime(150);
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('E2E78-P1B');
  });

  it('does not go mute after the race guard fires — the field keeps accepting scans once the clear is uncommitted', () => {
    // Same uncommitted-clear window as the race test above, but this time
    // nothing ever calls Enter or otherwise forces a commit: the debounce
    // fires (submittedRef = true, setValue('') scheduled but not flushed
    // through act()), and then four more scans arrive back to back, exactly
    // as a scanner gun would send them. Every one of them must reach
    // onScan — a guard that only re-arms by reading committed React state
    // (`value`) never sees the empty->non-empty transition here, because
    // `value` is still the pre-clear code in every one of these closures,
    // and stays mute forever (until an unrelated remount).
    vi.useFakeTimers();
    const onScan = vi.fn();
    render(<ScanField onScan={onScan} />);
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'AAAA1111' } });
    vi.advanceTimersByTime(150); // debounce fires, setValue('') left uncommitted
    fireEvent.change(input, { target: { value: 'BBBB2222' } });
    vi.advanceTimersByTime(150);
    fireEvent.change(input, { target: { value: 'CCCC3333' } });
    vi.advanceTimersByTime(150);
    fireEvent.change(input, { target: { value: 'DDDD4444' } });
    vi.advanceTimersByTime(150);

    expect(onScan.mock.calls).toEqual([
      ['AAAA1111'],
      ['BBBB2222'],
      ['CCCC3333'],
      ['DDDD4444'],
    ]);
  });

  it('still submits two distinct scans in a row after the race guard fires — the guard must not collapse legitimate consecutive scans', () => {
    vi.useFakeTimers();
    const onScan = vi.fn();
    render(<ScanField onScan={onScan} />);
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'E2E78-P1A' } });
    act(() => vi.advanceTimersByTime(150));
    fireEvent.change(input, { target: { value: 'E2E78-P1B' } });
    act(() => vi.advanceTimersByTime(150));

    expect(onScan).toHaveBeenCalledTimes(2);
    expect(onScan).toHaveBeenNthCalledWith(1, 'E2E78-P1A');
    expect(onScan).toHaveBeenNthCalledWith(2, 'E2E78-P1B');
  });

  it('does not auto-submit while disabled', () => {
    vi.useFakeTimers();
    const onScan = vi.fn();
    render(<ScanField onScan={onScan} disabled />);
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'CL7742891003' } });
    act(() => vi.advanceTimersByTime(500));

    expect(onScan).not.toHaveBeenCalled();
  });

  it('submits the code on Enter and clears itself', () => {
    const onScan = vi.fn();
    render(<ScanField onScan={onScan} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'CL7742891003' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onScan).toHaveBeenCalledWith('CL7742891003');
    // Clearing itself is what lets the operator scan continuously without
    // reaching for the keyboard between packages.
    expect(input.value).toBe('');
  });

  it('trims surrounding whitespace a scanner may append', () => {
    const onScan = vi.fn();
    render(<ScanField onScan={onScan} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '  CL774289  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onScan).toHaveBeenCalledWith('CL774289');
  });

  it('ignores Enter on an empty or whitespace-only field', () => {
    const onScan = vi.fn();
    render(<ScanField onScan={onScan} />);
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onScan).not.toHaveBeenCalled();
  });

  it('has no submit button — the scanner is the only input path', () => {
    render(<ScanField onScan={vi.fn()} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('autofocuses so a scan lands without the operator touching the screen', () => {
    render(<ScanField onScan={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });

  it('renders the helper text and an accessible label', () => {
    render(<ScanField onScan={vi.fn()} helperText="Escanea o escribe el código y presiona Enter" />);
    expect(screen.getByText('Escanea o escribe el código y presiona Enter')).toBeInTheDocument();
    expect(screen.getByLabelText('Código de barras')).toBeInTheDocument();
  });

  it('does not fire while disabled', () => {
    const onScan = vi.fn();
    render(<ScanField onScan={onScan} disabled />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'CL1' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onScan).not.toHaveBeenCalled();
  });

  // Review fix #1 — SealPositionCard mounts a second ScanField that must
  // not steal the operator's scanner-gun input from the package field.
  it('does not autofocus when autoFocus is false', () => {
    render(
      <>
        <input aria-label="other field" autoFocus />
        <ScanField onScan={vi.fn()} autoFocus={false} />
      </>,
    );
    expect(document.activeElement).not.toBe(screen.getByLabelText('Código de barras'));
    expect(document.activeElement).toBe(screen.getByLabelText('other field'));
  });

  it('takes focus once autoFocus flips from false to true', () => {
    const { rerender } = render(<ScanField onScan={vi.fn()} autoFocus={false} />);
    const input = screen.getByRole('textbox');
    expect(document.activeElement).not.toBe(input);

    rerender(<ScanField onScan={vi.fn()} autoFocus />);
    expect(document.activeElement).toBe(input);
  });

  it('reports when it loses and regains focus', async () => {
    const onFocusStateChange = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <ScanField onScan={vi.fn()} onFocusStateChange={onFocusStateChange} />
        <button type="button">steal focus</button>
      </>,
    );
    // The mount effect focuses the input, so the first notification is `true`.
    expect(onFocusStateChange).toHaveBeenLastCalledWith(true);

    await user.click(screen.getByRole('button', { name: 'steal focus' }));
    expect(onFocusStateChange).toHaveBeenLastCalledWith(false);
  });
});
