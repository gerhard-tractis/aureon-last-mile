import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScanZone } from './ScanZone';

describe('ScanZone', () => {
  it('renders scan input', () => {
    render(<ScanZone onScan={vi.fn()} disabled={false} lastError={null} />);
    expect(screen.getByPlaceholderText(/escanea/i)).toBeInTheDocument();
  });

  it('calls onScan with input value on Enter', () => {
    const onScan = vi.fn();
    render(<ScanZone onScan={onScan} disabled={false} lastError={null} />);
    const input = screen.getByPlaceholderText(/escanea/i);
    fireEvent.change(input, { target: { value: 'BARCODE-1' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onScan).toHaveBeenCalledWith('BARCODE-1');
  });

  it('clears input after scan', () => {
    render(<ScanZone onScan={vi.fn()} disabled={false} lastError={null} />);
    const input = screen.getByPlaceholderText(/escanea/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'BARCODE-1' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('');
  });

  it('shows error message when lastError is set', () => {
    render(<ScanZone onScan={vi.fn()} disabled={false} lastError="Código no encontrado" />);
    expect(screen.getByText('Código no encontrado')).toBeInTheDocument();
  });

  it('disables input when disabled=true', () => {
    render(<ScanZone onScan={vi.fn()} disabled={true} lastError={null} />);
    expect(screen.getByPlaceholderText(/escanea/i)).toBeDisabled();
  });
});
