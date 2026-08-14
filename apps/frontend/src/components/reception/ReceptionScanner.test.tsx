import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReceptionScanner } from './ReceptionScanner';

describe('ReceptionScanner', () => {
  const defaultProps = {
    onScan: vi.fn(),
    disabled: false,
    lastScanResult: null as null | { scanResult: string; message?: string },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders input with Spanish placeholder', () => {
    render(<ReceptionScanner {...defaultProps} />);
    expect(
      screen.getByPlaceholderText('Escanear código de barras...')
    ).toBeInTheDocument();
  });

  it('calls onScan with trimmed value on Enter', async () => {
    const onScan = vi.fn();
    render(<ReceptionScanner {...defaultProps} onScan={onScan} />);
    const input = screen.getByRole('textbox');
    await userEvent.type(input, 'CTN12345{Enter}');
    expect(onScan).toHaveBeenCalledWith('CTN12345');
  });

  it('clears input after scan', async () => {
    render(<ReceptionScanner {...defaultProps} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    await userEvent.type(input, 'CTN12345{Enter}');
    expect(input.value).toBe('');
  });

  it('does not call onScan on empty input', () => {
    const onScan = vi.fn();
    render(<ReceptionScanner {...defaultProps} onScan={onScan} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(onScan).not.toHaveBeenCalled();
  });

  it('is disabled when disabled prop is true', () => {
    render(<ReceptionScanner {...defaultProps} disabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('has aria-label for accessibility', () => {
    render(<ReceptionScanner {...defaultProps} />);
    expect(
      screen.getByLabelText('Escáner de recepción')
    ).toBeInTheDocument();
  });

  it('shows error message when lastScanResult has not_found', () => {
    render(
      <ReceptionScanner
        {...defaultProps}
        lastScanResult={{
          scanResult: 'not_found',
          message: 'Paquete no pertenece a esta carga',
        }}
      />
    );
    expect(
      screen.getByText('Paquete no pertenece a esta carga')
    ).toBeInTheDocument();
  });

  it('shows duplicate warning when lastScanResult is duplicate', () => {
    render(
      <ReceptionScanner
        {...defaultProps}
        lastScanResult={{ scanResult: 'duplicate' }}
      />
    );
    expect(screen.getByText('Paquete ya escaneado')).toBeInTheDocument();
  });

  it('shows success message when lastScanResult is received', () => {
    render(
      <ReceptionScanner
        {...defaultProps}
        lastScanResult={{ scanResult: 'received' }}
      />
    );
    expect(screen.getByText('Paquete recibido')).toBeInTheDocument();
  });

  it('auto-submits after a fast keystroke burst with no terminator (hardware scanner)', () => {
    vi.useFakeTimers();
    const onScan = vi.fn();
    render(<ReceptionScanner {...defaultProps} onScan={onScan} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'C' } });
    fireEvent.change(input, { target: { value: 'CT' } });
    fireEvent.change(input, { target: { value: 'CTN' } });
    fireEvent.change(input, { target: { value: 'CTN12345' } });

    act(() => vi.advanceTimersByTime(80));
    expect(onScan).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(100));
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('CTN12345');
    expect(input.value).toBe('');
  });

  it('auto-submits a realistic scanner burst whose characters spread over more than 200 ms', () => {
    vi.useFakeTimers();
    const onScan = vi.fn();
    render(<ReceptionScanner {...defaultProps} onScan={onScan} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;

    // Real keyboard-wedge scanners (Bluetooth/Android especially) emit
    // ~15–50 ms per character, so a 10-char CTN takes well over 200 ms end
    // to end — but every inter-key gap stays tiny.
    const code = 'CTN1234567';
    for (let i = 1; i <= code.length; i++) {
      fireEvent.change(input, { target: { value: code.slice(0, i) } });
      act(() => vi.advanceTimersByTime(25));
    }

    act(() => vi.advanceTimersByTime(120));
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith(code);
    expect(input.value).toBe('');
  });

  it('does not auto-submit when keystrokes arrive at human typing speed', () => {
    vi.useFakeTimers();
    const onScan = vi.fn();
    render(<ReceptionScanner {...defaultProps} onScan={onScan} />);
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
    render(<ReceptionScanner {...defaultProps} onScan={onScan} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'CTN12345' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    act(() => vi.advanceTimersByTime(500));
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('CTN12345');
  });

  describe('ScanFeedbackBanner', () => {
    it('shows the received banner', () => {
      render(
        <ReceptionScanner {...defaultProps} lastScanResult={{ scanResult: 'received' }} />
      );
      expect(screen.getByText('Paquete recibido')).toBeInTheDocument();
    });

    it('shows the duplicate banner', () => {
      render(
        <ReceptionScanner {...defaultProps} lastScanResult={{ scanResult: 'duplicate' }} />
      );
      expect(screen.getByText('Paquete ya escaneado')).toBeInTheDocument();
    });

    it('shows a wrong-truck banner for route_mismatch, not the generic not_found text', () => {
      render(
        <ReceptionScanner
          {...defaultProps}
          lastScanResult={{ scanResult: 'route_mismatch' }}
        />
      );
      expect(screen.getByText('Paquete de otro camión')).toBeInTheDocument();
      expect(screen.queryByText('Paquete no encontrado')).not.toBeInTheDocument();
    });

    it('prefers the validator message for route_mismatch when present', () => {
      render(
        <ReceptionScanner
          {...defaultProps}
          lastScanResult={{
            scanResult: 'route_mismatch',
            message: 'Paquete no pertenece a este camión',
          }}
        />
      );
      expect(
        screen.getByText('Paquete no pertenece a este camión')
      ).toBeInTheDocument();
    });

    it('falls back to the not_found banner for any other result', () => {
      render(
        <ReceptionScanner {...defaultProps} lastScanResult={{ scanResult: 'not_found' }} />
      );
      expect(screen.getByText('Paquete no encontrado')).toBeInTheDocument();
    });
  });
});
