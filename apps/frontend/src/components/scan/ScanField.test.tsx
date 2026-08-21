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
