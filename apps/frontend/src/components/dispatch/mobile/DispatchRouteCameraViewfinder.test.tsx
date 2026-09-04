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

  it('spec-76 2g #16 — renders when active', () => {
    // spec-76 review minor — a class-name assertion ("max-h-[220px]")
    // breaks on any Tailwind refactor while proving nothing about the
    // actual requirement (decision 4: the counter has to stay visible).
    // This component does not own the header/counter — DispatchRouteScan
    // Session does — so the requirement is genuinely asserted at THAT
    // boundary: DispatchRouteScanSession.test.tsx's "Cámara swaps the
    // reader for the viewfinder in the SAME screen" test renders the
    // route code and `dispatch-scan-counter` alongside the (stubbed)
    // viewfinder to prove neither ever leaves the screen while the camera
    // is active. This test only proves the viewfinder itself mounts.
    render(<DispatchRouteCameraViewfinder active onDecode={vi.fn()} />);
    expect(screen.getByTestId('dispatch-camera-viewfinder')).toBeInTheDocument();
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
