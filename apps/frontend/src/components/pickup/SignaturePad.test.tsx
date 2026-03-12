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
  it('renders label', () => {
    render(<SignaturePad label="Operator Signature" onChange={vi.fn()} />);
    expect(screen.getByText('Operator Signature')).toBeInTheDocument();
  });

  it('renders canvas with aria-label', () => {
    render(<SignaturePad label="Operator Signature" onChange={vi.fn()} />);
    expect(
      screen.getByLabelText('Operator Signature signature area')
    ).toBeInTheDocument();
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

  it('shows clear button after drawing', () => {
    render(<SignaturePad label="Test" onChange={vi.fn()} />);
    const canvas = screen.getByLabelText('Test signature area');

    expect(screen.queryByText('Clear')).not.toBeInTheDocument();

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.mouseUp(canvas);

    expect(screen.getByText('Clear')).toBeInTheDocument();
  });

  it('calls onChange with null when cleared', () => {
    const onChange = vi.fn();
    render(<SignaturePad label="Test" onChange={onChange} />);
    const canvas = screen.getByLabelText('Test signature area');

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.mouseUp(canvas);

    fireEvent.click(screen.getByText('Clear'));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
