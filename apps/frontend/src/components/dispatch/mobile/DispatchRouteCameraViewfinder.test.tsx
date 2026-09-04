import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DispatchRouteCameraViewfinder } from './DispatchRouteCameraViewfinder';

const mockUseBarcodeCameraScan = vi.fn();
vi.mock('@/hooks/dispatch/mobile/useBarcodeCameraScan', () => ({
  useBarcodeCameraScan: (opts: unknown) => mockUseBarcodeCameraScan(opts),
}));

describe('DispatchRouteCameraViewfinder', () => {
  beforeEach(() => {
    mockUseBarcodeCameraScan.mockReset();
    mockUseBarcodeCameraScan.mockReturnValue({ cameraError: false, readerElementId: 'dispatch-camera-reader' });
  });

  it('renders nothing when inactive', () => {
    render(<DispatchRouteCameraViewfinder active={false} onDecode={vi.fn()} />);
    expect(screen.queryByTestId('dispatch-camera-viewfinder')).not.toBeInTheDocument();
  });

  it('spec-76 2g #16 — renders a bounded viewfinder, never full-screen, when active', () => {
    render(<DispatchRouteCameraViewfinder active onDecode={vi.fn()} />);
    const viewfinder = screen.getByTestId('dispatch-camera-viewfinder');
    expect(viewfinder).toBeInTheDocument();
    expect(viewfinder.className).toMatch(/max-h-\[220px\]/);
  });

  it('spec-76 2g #17 — camera permission denied shows a message, not a blank viewfinder', () => {
    mockUseBarcodeCameraScan.mockReturnValue({ cameraError: true, readerElementId: 'dispatch-camera-reader' });
    render(<DispatchRouteCameraViewfinder active onDecode={vi.fn()} />);
    expect(screen.getByText(/no se pudo acceder a la cámara/i)).toBeInTheDocument();
  });

  it('passes active and onDecode straight through to the hook', () => {
    const onDecode = vi.fn();
    render(<DispatchRouteCameraViewfinder active onDecode={onDecode} />);
    expect(mockUseBarcodeCameraScan).toHaveBeenCalledWith({ active: true, onDecode });
  });
});
