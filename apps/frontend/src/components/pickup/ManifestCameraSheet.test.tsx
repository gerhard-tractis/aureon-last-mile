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

/** Simula al navegador reportando frames reales tras `loadedmetadata`. */
function makeVideoReady(width = 640, height = 480) {
  const video = screen.getByTestId('manifest-camera-video') as HTMLVideoElement;
  Object.defineProperty(video, 'videoWidth', { value: width, configurable: true });
  Object.defineProperty(video, 'videoHeight', { value: height, configurable: true });
  fireEvent(video, new Event('loadedmetadata'));
  return video;
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
    mockToBlob.mockImplementation((cb: (blob: Blob | null) => void) =>
      cb(new Blob(['jpeg-bytes'], { type: 'image/jpeg' }))
    );
    mockGetContext.mockImplementation(() => ({ drawImage: vi.fn() }));
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

  // Bloqueante 1, ronda 2 de review del PR #713 — el obturador estaba
  // habilitado desde el primer frame, durante todo el diálogo de permiso
  // del sistema. Un toque ahí producía un canvas 1080x1440 sin señal real:
  // negro sólido, ~1.5MB, un File "válido" para el bucket con cero
  // información — exactamente la evidencia que spec-80 necesita para
  // defender una indemnización.
  describe('B1 — el obturador no puede disparar sobre un stream que aún no existe', () => {
    it('disables the shutter while getUserMedia is still pending', async () => {
      let resolveGetUserMedia!: (s: MediaStream) => void;
      getUserMedia.mockReturnValue(
        new Promise<MediaStream>((resolve) => {
          resolveGetUserMedia = resolve;
        })
      );
      const onCapture = vi.fn();
      render(<ManifestCameraSheet {...baseProps} onCapture={onCapture} />);
      await waitFor(() => expect(getUserMedia).toHaveBeenCalled());

      expect(screen.getByRole('button', { name: /capturar/i })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: /capturar/i }));
      expect(onCapture).not.toHaveBeenCalled();

      // cleanup: resolve so the pending promise doesn't leak into other tests
      resolveGetUserMedia(makeFakeStream().stream);
    });

    it('enables the shutter once the video reports real dimensions, and captures using those dimensions (not a hardcoded default)', async () => {
      const { stream } = makeFakeStream();
      getUserMedia.mockResolvedValue(stream);
      const onCapture = vi.fn();
      render(<ManifestCameraSheet {...baseProps} onCapture={onCapture} />);
      await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
      expect(screen.getByRole('button', { name: /capturar/i })).toBeDisabled();

      makeVideoReady(640, 480);
      await waitFor(() => expect(screen.getByRole('button', { name: /capturar/i })).not.toBeDisabled());

      fireEvent.click(screen.getByRole('button', { name: /capturar/i }));
      await waitFor(() => expect(onCapture).toHaveBeenCalledOnce());

      const canvas = screen.getByTestId('manifest-camera-canvas') as HTMLCanvasElement;
      expect(canvas.width).toBe(640);
      expect(canvas.height).toBe(480);
    });

    it('rejects the capture defensively if the video dimensions drop to zero after becoming ready (e.g. the track ended)', async () => {
      const { stream } = makeFakeStream();
      getUserMedia.mockResolvedValue(stream);
      const onCapture = vi.fn();
      render(<ManifestCameraSheet {...baseProps} onCapture={onCapture} />);
      await waitFor(() => expect(getUserMedia).toHaveBeenCalled());

      const video = makeVideoReady(640, 480);
      await waitFor(() => expect(screen.getByRole('button', { name: /capturar/i })).not.toBeDisabled());

      // Simulate the track dying mid-session without another loadedmetadata event.
      Object.defineProperty(video, 'videoWidth', { value: 0, configurable: true });
      Object.defineProperty(video, 'videoHeight', { value: 0, configurable: true });

      fireEvent.click(screen.getByRole('button', { name: /capturar/i }));
      expect(onCapture).not.toHaveBeenCalled();
    });
  });

  it('captures a frame into a File and calls onCapture when the shutter is pressed', async () => {
    const { stream } = makeFakeStream();
    getUserMedia.mockResolvedValue(stream);
    const onCapture = vi.fn();
    render(<ManifestCameraSheet {...baseProps} onCapture={onCapture} sheetNumber={3} />);

    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    makeVideoReady();
    await waitFor(() => expect(screen.getByRole('button', { name: /capturar/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /capturar/i }));

    await waitFor(() => expect(onCapture).toHaveBeenCalledOnce());
    const file = onCapture.mock.calls[0][0] as File;
    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe('image/jpeg');
  });

  // Menores, ronda 2 de review del PR #713 — mutantes que sobrevivían.
  describe('menores — calidad, mime real y contenido del File capturado', () => {
    async function captureOnce(onCapture = vi.fn()) {
      const { stream } = makeFakeStream();
      getUserMedia.mockResolvedValue(stream);
      render(<ManifestCameraSheet {...baseProps} onCapture={onCapture} />);
      await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
      makeVideoReady();
      await waitFor(() => expect(screen.getByRole('button', { name: /capturar/i })).not.toBeDisabled());
      fireEvent.click(screen.getByRole('button', { name: /capturar/i }));
      await waitFor(() => expect(onCapture).toHaveBeenCalledOnce());
      return onCapture;
    }

    it('asks the canvas for a JPEG at 0.9 quality, not an arbitrary value', async () => {
      await captureOnce();
      expect(mockToBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.9);
    });

    it('produces a File whose size reflects the actual captured bytes, not an empty file', async () => {
      const onCapture = await captureOnce();
      const file = onCapture.mock.calls[0][0] as File;
      expect(file.size).toBe(new Blob(['jpeg-bytes']).size);
      expect(file.size).toBeGreaterThan(0);
    });

    it('derives the File type from the blob toBlob actually produced, not a hardcoded literal', async () => {
      mockToBlob.mockImplementationOnce((cb: (blob: Blob | null) => void) =>
        cb(new Blob(['png-bytes'], { type: 'image/png' }))
      );
      const onCapture = await captureOnce();
      const file = onCapture.mock.calls[0][0] as File;
      expect(file.type).toBe('image/png');
    });
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

  // M1, ronda 2 de review del PR #713 — `open` para quien siga la
  // convención local de Radix (montado siempre, open/onOpenChange).
  describe('M1 — el prop open', () => {
    it('does not request the camera while open=false', async () => {
      render(<ManifestCameraSheet {...baseProps} open={false} />);
      await new Promise((r) => setTimeout(r, 0));
      expect(getUserMedia).not.toHaveBeenCalled();
    });

    it('stops the stream when open flips to false without unmounting', async () => {
      const { stream, stop } = makeFakeStream();
      getUserMedia.mockResolvedValue(stream);
      const { rerender } = render(<ManifestCameraSheet {...baseProps} open />);
      await waitFor(() => expect(getUserMedia).toHaveBeenCalled());

      rerender(<ManifestCameraSheet {...baseProps} open={false} />);
      await waitFor(() => expect(stop).toHaveBeenCalledOnce());
    });

    it('requests the camera again when open flips back to true', async () => {
      const { stream } = makeFakeStream();
      getUserMedia.mockResolvedValue(stream);
      const { rerender } = render(<ManifestCameraSheet {...baseProps} open={false} />);
      expect(getUserMedia).not.toHaveBeenCalled();

      rerender(<ManifestCameraSheet {...baseProps} open />);
      await waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
    });
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
    makeVideoReady();
    await waitFor(() => expect(screen.getByRole('button', { name: /capturar/i })).not.toBeDisabled());

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
    makeVideoReady();
    await waitFor(() => expect(screen.getByRole('button', { name: /capturar/i })).not.toBeDisabled());

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

  // M3, ronda 2 de review del PR #713 — el bucket `manifests` acota tamaño
  // y mime (packages/database/supabase/migrations/
  // 20260430000001_create_manifests_storage_bucket.sql). El fallback debe
  // rechazar ANTES, con el operario delante, no dejar que reviente al
  // drenar la cola offline horas después.
  describe('M3 — el fallback respeta los límites del bucket', () => {
    it('rejects a fallback file over 10MiB and does not call onCapture', async () => {
      // @ts-expect-error - simulate a browser/PWA without camera stream support
      delete global.navigator.mediaDevices;
      const onCapture = vi.fn();
      render(<ManifestCameraSheet {...baseProps} onCapture={onCapture} />);
      const input = await screen.findByTestId('manifest-camera-fallback-input');

      const oversized = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'sheet.jpg', {
        type: 'image/jpeg',
      });
      fireEvent.change(input, { target: { files: [oversized] } });

      expect(onCapture).not.toHaveBeenCalled();
      expect(screen.getByText(/pesa demasiado/i)).toBeInTheDocument();
    });

    it('rejects a fallback file whose mime type is not in the bucket allow-list', async () => {
      // @ts-expect-error - simulate a browser/PWA without camera stream support
      delete global.navigator.mediaDevices;
      const onCapture = vi.fn();
      render(<ManifestCameraSheet {...baseProps} onCapture={onCapture} />);
      const input = await screen.findByTestId('manifest-camera-fallback-input');

      const badMime = new File(['data'], 'sheet.pdf', { type: 'application/pdf' });
      fireEvent.change(input, { target: { files: [badMime] } });

      expect(onCapture).not.toHaveBeenCalled();
      expect(screen.getByText(/formato no soportado/i)).toBeInTheDocument();
    });

    it('accepts an iOS HEIC photo, which is in the bucket allow-list', async () => {
      // @ts-expect-error - simulate a browser/PWA without camera stream support
      delete global.navigator.mediaDevices;
      const onCapture = vi.fn();
      render(<ManifestCameraSheet {...baseProps} onCapture={onCapture} />);
      const input = await screen.findByTestId('manifest-camera-fallback-input');

      const heic = new File(['data'], 'sheet.heic', { type: 'image/heic' });
      fireEvent.change(input, { target: { files: [heic] } });

      expect(onCapture).toHaveBeenCalledWith(heic);
    });
  });

  it('sets capture="environment" on the fallback input, not "user"', async () => {
    // @ts-expect-error - simulate a browser/PWA without camera stream support
    delete global.navigator.mediaDevices;
    render(<ManifestCameraSheet {...baseProps} />);
    const input = await screen.findByTestId('manifest-camera-fallback-input');
    expect(input).toHaveAttribute('capture', 'environment');
  });
});
