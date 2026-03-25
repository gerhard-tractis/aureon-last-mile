import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SignaturePad } from './SignaturePad';

// Mock canvas context
const mockContext = {
  strokeStyle: '',
  lineWidth: 0,
  lineCap: '',
  lineJoin: '',
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  clearRect: vi.fn(),
};

HTMLCanvasElement.prototype.getContext = vi.fn(
  () => mockContext
) as unknown as typeof HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.toDataURL = vi.fn(
  () => 'data:image/png;base64,mock'
);

describe('SignaturePad', () => {
  beforeEach(() => {
    mockContext.strokeStyle = '';
  });

  it('renders label', () => {
    render(<SignaturePad label="Firma del operador" onChange={vi.fn()} />);
    expect(screen.getByText('Firma del operador')).toBeInTheDocument();
  });

  it('renders canvas with aria-label', () => {
    render(<SignaturePad label="Firma del operador" onChange={vi.fn()} />);
    expect(
      screen.getByLabelText('Firma del operador signature area')
    ).toBeInTheDocument();
  });

  it('does not use hardcoded #000 for stroke color', () => {
    render(<SignaturePad label="Test" onChange={vi.fn()} />);
    // strokeStyle should NOT be '#000' — it should read from CSS variable
    expect(mockContext.strokeStyle).not.toBe('#000');
  });

  it('calls onChange with data URL after drawing', () => {
    const onChange = vi.fn();
    render(<SignaturePad label="Test" onChange={onChange} />);
    const canvas = screen.getByLabelText('Test signature area');

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(canvas, { clientX: 20, clientY: 20 });
    fireEvent.mouseUp(canvas);

    expect(onChange).toHaveBeenCalledWith('data:image/png;base64,mock');
  });

  it('shows Borrar button after drawing', () => {
    render(<SignaturePad label="Test" onChange={vi.fn()} />);
    const canvas = screen.getByLabelText('Test signature area');

    expect(screen.queryByText('Borrar')).not.toBeInTheDocument();

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.mouseUp(canvas);

    expect(screen.getByText('Borrar')).toBeInTheDocument();
  });

  it('calls onChange with null when cleared', () => {
    const onChange = vi.fn();
    render(<SignaturePad label="Test" onChange={onChange} />);
    const canvas = screen.getByLabelText('Test signature area');

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.mouseUp(canvas);

    fireEvent.click(screen.getByText('Borrar'));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
