import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScannerInput } from './ScannerInput';

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
});
