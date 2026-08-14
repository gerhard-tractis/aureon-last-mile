import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScanField } from './ScanField';

describe('ScanField', () => {
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
});
