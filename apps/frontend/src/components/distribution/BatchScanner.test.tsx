import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { BatchScanner } from './BatchScanner';
import type { DockScanValidationResult } from '@/lib/distribution/dock-scan-validator';

afterEach(() => {
  vi.useRealTimers();
});

describe('BatchScanner', () => {
  it('auto-submits a realistic scanner burst with no Enter suffix', () => {
    vi.useFakeTimers();
    const onScan = vi.fn();
    render(<BatchScanner onScan={onScan} lastResult={null} disabled={false} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;

    const code = 'PKG-0012345';
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
    render(<BatchScanner onScan={onScan} lastResult={null} disabled={false} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'PKG' } });
    act(() => vi.advanceTimersByTime(300));
    fireEvent.change(input, { target: { value: 'PKG-001' } });
    act(() => vi.advanceTimersByTime(500));

    expect(onScan).not.toHaveBeenCalled();
    expect(input.value).toBe('PKG-001');
  });

  it('does not double-fire when Enter arrives at the end of a burst', () => {
    vi.useFakeTimers();
    const onScan = vi.fn();
    render(<BatchScanner onScan={onScan} lastResult={null} disabled={false} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'PKG-001' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    act(() => vi.advanceTimersByTime(500));

    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it('does not auto-submit while disabled', () => {
    vi.useFakeTimers();
    const onScan = vi.fn();
    render(<BatchScanner onScan={onScan} lastResult={null} disabled />);
    const input = screen.getByRole('textbox') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'PKG-001' } });
    act(() => vi.advanceTimersByTime(500));

    expect(onScan).not.toHaveBeenCalled();
  });

  it('renders scanner input', () => {
    render(<BatchScanner onScan={vi.fn()} lastResult={null} disabled={false} />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('shows accepted feedback when last result is accepted', () => {
    const lastResult: DockScanValidationResult = {
      scanResult: 'accepted',
      packageId: 'p1',
      packageLabel: 'PKG-001',
    };
    render(<BatchScanner onScan={vi.fn()} lastResult={lastResult} disabled={false} />);
    expect(screen.getByText(/aceptado/i)).toBeInTheDocument();
  });

  it('shows package label in accepted feedback', () => {
    const lastResult: DockScanValidationResult = {
      scanResult: 'accepted',
      packageId: 'p1',
      packageLabel: 'PKG-001',
    };
    render(<BatchScanner onScan={vi.fn()} lastResult={lastResult} disabled={false} />);
    expect(screen.getByText('PKG-001')).toBeInTheDocument();
  });

  it('shows rejected feedback when last result is rejected', () => {
    const lastResult: DockScanValidationResult = {
      scanResult: 'rejected',
      packageId: null,
      packageLabel: null,
      message: 'No pertenece a este andén',
    };
    render(<BatchScanner onScan={vi.fn()} lastResult={lastResult} disabled={false} />);
    expect(screen.getByText(/no pertenece/i)).toBeInTheDocument();
  });

  it('calls onScan when Enter is pressed', () => {
    const onScan = vi.fn();
    render(<BatchScanner onScan={onScan} lastResult={null} disabled={false} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'PKG-999' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onScan).toHaveBeenCalledWith('PKG-999');
  });

  it('clears input after scan', () => {
    render(<BatchScanner onScan={vi.fn()} lastResult={null} disabled={false} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'PKG-999' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('');
  });

  it('does not call onScan when disabled', () => {
    const onScan = vi.fn();
    render(<BatchScanner onScan={onScan} lastResult={null} disabled={true} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'PKG-999' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onScan).not.toHaveBeenCalled();
  });
});
