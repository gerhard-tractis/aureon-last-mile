import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScannerInput } from './ScannerInput';

afterEach(() => {
  vi.useRealTimers();
});

describe('ScannerInput', () => {
  it('renders input with placeholder', () => {
    render(<ScannerInput onScan={vi.fn()} />);
    expect(screen.getByPlaceholderText('Scan barcode...')).toBeInTheDocument();
  });

  it('calls onScan with trimmed value on Enter', async () => {
    const onScan = vi.fn();
    render(<ScannerInput onScan={onScan} />);
    const input = screen.getByRole('textbox');
    await userEvent.type(input, 'CTN12345{Enter}');
    expect(onScan).toHaveBeenCalledWith('CTN12345');
  });

  it('clears input after scan', async () => {
    render(<ScannerInput onScan={vi.fn()} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    await userEvent.type(input, 'CTN12345{Enter}');
    expect(input.value).toBe('');
  });

  it('does not call onScan on empty input', () => {
    const onScan = vi.fn();
    render(<ScannerInput onScan={onScan} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(onScan).not.toHaveBeenCalled();
  });

  it('is disabled when disabled prop is true', () => {
    render(<ScannerInput onScan={vi.fn()} disabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('has aria-label for accessibility', () => {
    render(<ScannerInput onScan={vi.fn()} />);
    expect(screen.getByLabelText('Barcode scanner input')).toBeInTheDocument();
  });

  it('auto-submits after a fast keystroke burst with no terminator (hardware scanner)', () => {
    vi.useFakeTimers();
    const onScan = vi.fn();
    render(<ScannerInput onScan={onScan} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;

    // Hardware scanner pumps characters too fast for fake timers to advance
    // between them, so all change events land at the same fake-clock instant.
    fireEvent.change(input, { target: { value: 'C' } });
    fireEvent.change(input, { target: { value: 'CT' } });
    fireEvent.change(input, { target: { value: 'CTN' } });
    fireEvent.change(input, { target: { value: 'CTN12345' } });

    // Mid-idle: still under the auto-submit threshold.
    act(() => vi.advanceTimersByTime(80));
    expect(onScan).not.toHaveBeenCalled();

    // Past the idle threshold (~120 ms): treat as a complete scan.
    act(() => vi.advanceTimersByTime(100));
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('CTN12345');
    expect(input.value).toBe('');
  });

  it('does not auto-submit when keystrokes arrive at human typing speed', () => {
    vi.useFakeTimers();
    const onScan = vi.fn();
    render(<ScannerInput onScan={onScan} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'A' } });
    act(() => vi.advanceTimersByTime(250));
    fireEvent.change(input, { target: { value: 'AB' } });
    act(() => vi.advanceTimersByTime(250));
    fireEvent.change(input, { target: { value: 'ABC1234' } });
    act(() => vi.advanceTimersByTime(500));

    expect(onScan).not.toHaveBeenCalled();
    expect(input.value).toBe('ABC1234');
  });

  it('does not double-fire when Enter arrives at the end of a burst', () => {
    vi.useFakeTimers();
    const onScan = vi.fn();
    render(<ScannerInput onScan={onScan} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'CTN12345' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Drain any pending timers — the Enter path should have already fired
    // and cancelled the auto-submit, so we should still see exactly one call.
    act(() => vi.advanceTimersByTime(500));
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('CTN12345');
  });
});
