import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ManifestCameraSheet } from './ManifestCameraSheet';

function makeFakeStream() {
  const stop = vi.fn();
  const track = { stop };
  return {
    stream: { getTracks: () => [track] } as unknown as MediaStream,
    stop,
  };
}

const mockToBlob = vi.fn(
  (cb: (blob: Blob | null) => void) => cb(new Blob(['jpeg-bytes'], { type: 'image/jpeg' }))
);
const mockGetContext = vi.fn(() => ({
  drawImage: vi.fn(),
}));

HTMLCanvasElement.prototype.getContext = mockGetContext as unknown as typeof HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.toBlob = mockToBlob as unknown as typeof HTMLCanvasElement.prototype.toBlob;

const baseProps = {
  loadLabel: 'CARGA-99814',
  sheetNumber: 3,
  capturedCount: 2,
  onClose: vi.fn(),
  onCapture: vi.fn(),
  onDone: vi.fn(),
};

describe('ManifestCameraSheet', () => {
  let getUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    getUserMedia = vi.fn();
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
    });
  });

  afterEach(() => {
    // @ts-expect-error - cleanup jsdom navigator shim between tests
    delete global.navigator.mediaDevices;
  });

  it('requests the environment-facing camera on mount', async () => {
    const { stream } = makeFakeStream();
    getUserMedia.mockResolvedValue(stream);
    render(<ManifestCameraSheet {...baseProps} />);
    await waitFor(() =>
      expect(getUserMedia).toHaveBeenCalledWith(
        expect.objectContaining({ video: expect.objectContaining({ facingMode: 'environment' }) })
      )
    );
  });

  it('shows the literal framing caption from the mock', async () => {
    const { stream } = makeFakeStream();
    getUserMedia.mockResolvedValue(stream);
    render(<ManifestCameraSheet {...baseProps} />);
    expect(
      screen.getByText('Encuadra la hoja completa, con la firma visible')
    ).toBeInTheDocument();
  });

  it('shows the sheet number, load label and subtitle', async () => {
    const { stream } = makeFakeStream();
    getUserMedia.mockResolvedValue(stream);
    render(<ManifestCameraSheet {...baseProps} />);
    expect(screen.getByText('Hoja 3 de CARGA-99814')).toBeInTheDocument();
    expect(screen.getByText('Manifiesto firmado')).toBeInTheDocument();
  });

  it('shows the already-captured count from the mock', async () => {
    const { stream } = makeFakeStream();
    getUserMedia.mockResolvedValue(stream);
    render(<ManifestCameraSheet {...baseProps} capturedCount={2} />);
    expect(screen.getByText('YA CAPTURADAS · 2')).toBeInTheDocument();
  });

  it('calls onClose when the close button is pressed', async () => {
    const { stream } = makeFakeStream();
    getUserMedia.mockResolvedValue(stream);
    const onClose = vi.fn();
    render(<ManifestCameraSheet {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /cerrar/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onDone when "Listo" is pressed', async () => {
    const { stream } = makeFakeStream();
    getUserMedia.mockResolvedValue(stream);
    const onDone = vi.fn();
    render(<ManifestCameraSheet {...baseProps} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Listo' }));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('captures a frame into a File and calls onCapture when the shutter is pressed', async () => {
    const { stream } = makeFakeStream();
    getUserMedia.mockResolvedValue(stream);
    const onCapture = vi.fn();
    render(<ManifestCameraSheet {...baseProps} onCapture={onCapture} sheetNumber={3} />);

    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /capturar/i }));

    await waitFor(() => expect(onCapture).toHaveBeenCalledOnce());
    const file = onCapture.mock.calls[0][0] as File;
    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe('image/jpeg');
  });

  it('stops every camera track on unmount', async () => {
    const { stream, stop } = makeFakeStream();
    getUserMedia.mockResolvedValue(stream);
    const { unmount } = render(<ManifestCameraSheet {...baseProps} />);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    unmount();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('stops the stream immediately if it resolves after the component already unmounted', async () => {
    const { stream, stop } = makeFakeStream();
    let resolveGetUserMedia!: (s: MediaStream) => void;
    getUserMedia.mockReturnValue(
      new Promise<MediaStream>((resolve) => {
        resolveGetUserMedia = resolve;
      })
    );
    const { unmount } = render(<ManifestCameraSheet {...baseProps} />);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    unmount();
    resolveGetUserMedia(stream);
    await waitFor(() => expect(stop).toHaveBeenCalledOnce());
  });

  it('disables the shutter button once it has fallen back to the file input', async () => {
    // @ts-expect-error - simulate a browser/PWA without camera stream support
    delete global.navigator.mediaDevices;
    render(<ManifestCameraSheet {...baseProps} />);
    await screen.findByTestId('manifest-camera-fallback-input');
    expect(screen.getByRole('button', { name: /capturar/i })).toBeDisabled();
  });

  it('does not call onCapture when the canvas has no 2D context', async () => {
    const { stream } = makeFakeStream();
    getUserMedia.mockResolvedValue(stream);
    mockGetContext.mockReturnValueOnce(null as unknown as ReturnType<typeof mockGetContext>);
    const onCapture = vi.fn();
    render(<ManifestCameraSheet {...baseProps} onCapture={onCapture} />);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /capturar/i }));
    expect(onCapture).not.toHaveBeenCalled();
  });

  it('does not call onCapture when toBlob yields no blob', async () => {
    const { stream } = makeFakeStream();
    getUserMedia.mockResolvedValue(stream);
    mockToBlob.mockImplementationOnce((cb: (blob: Blob | null) => void) => cb(null));
    const onCapture = vi.fn();
    render(<ManifestCameraSheet {...baseProps} onCapture={onCapture} />);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /capturar/i }));
    expect(onCapture).not.toHaveBeenCalled();
  });

  it('falls back to a native file input when getUserMedia is unavailable', async () => {
    // @ts-expect-error - simulate a browser/PWA without camera stream support
    delete global.navigator.mediaDevices;
    const onCapture = vi.fn();
    render(<ManifestCameraSheet {...baseProps} onCapture={onCapture} />);

    const input = await screen.findByTestId('manifest-camera-fallback-input');
    const file = new File(['data'], 'sheet.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onCapture).toHaveBeenCalledWith(file);
  });

  it('falls back to a native file input when getUserMedia rejects (permission denied)', async () => {
    getUserMedia.mockRejectedValue(new Error('Permission denied'));
    const onCapture = vi.fn();
    render(<ManifestCameraSheet {...baseProps} onCapture={onCapture} />);

    const input = await screen.findByTestId('manifest-camera-fallback-input');
    const file = new File(['data'], 'sheet.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onCapture).toHaveBeenCalledWith(file);
  });
});
