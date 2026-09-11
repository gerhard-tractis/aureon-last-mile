import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ManifestCameraSheet } from './ManifestCameraSheet';

/**
 * Un track "vivo" que soporta addEventListener('ended'|'mute'|'unmute', ...)
 * y las propiedades `readyState`/`muted` reales de un MediaStreamTrack —
 * necesarias para `isVideoReady` (ronda 4 de review del PR #713).
 *
 * `capabilities` es opcional a propósito (fase 9, spec-95): la mayoría de
 * los tests existentes no le importa el flash, y un track sin `torch` en
 * `getCapabilities()` es justamente el caso "no lo soporta" que el botón
 * debe degradar en silencio.
 */
class FakeTrack extends EventTarget {
  stop = vi.fn();
  readyState: 'live' | 'ended' = 'live';
  muted = false;
  applyConstraints = vi.fn().mockResolvedValue(undefined);
  #capabilities: MediaTrackCapabilities;

  constructor(capabilities: MediaTrackCapabilities = {}) {
    super();
    this.#capabilities = capabilities;
  }

  getCapabilities(): MediaTrackCapabilities {
    return this.#capabilities;
  }
}

function makeFakeStream(capabilities?: MediaTrackCapabilities) {
  const track = new FakeTrack(capabilities);
  return {
    stream: {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream,
    stop: track.stop,
    track,
  };
}

/**
 * Un track real de un dispositivo/navegador que ni siquiera expone
 * `getCapabilities` (la API es opcional en el estándar). La detección de
 * capacidad debe leer esto con `?.()`, no asumir que siempre existe.
 */
function makeStreamWithBareTrack() {
  const track = Object.assign(new EventTarget(), {
    stop: vi.fn(),
    readyState: 'live' as const,
    muted: false,
  });
  return {
    stream: {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream,
    track,
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

    // Ronda 4 de review del PR #713 — `canvas.width = video.videoWidth ||
    // 1080` sigue vivo, tercera ronda: `expect(canvas.width).toBe(640)` no
    // puede detectar ese mutante porque `640 || 1080 === 640`. El guard de
    // arriba (dimensiones cero → 0 capturas, cubierto por
    // `it.each` y por el test siguiente) ya protege el caso real; esta
    // aserción sólo confirma que el canvas usa las dimensiones reales
    // cuando SÍ las hay — no es, por sí sola, prueba contra el default.
    it('sizes the canvas from the video real dimensions once the shutter is enabled', async () => {
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

    // Ronda 3 de review del PR #713 — el eje del alto no lo miraba ningún
    // test, y `makeVideoReady` siempre fijaba dimensiones no nulas antes
    // del evento, así que nunca existía un `loadedmetadata` 0×N ni N×0 (el
    // caso real de Safari que motiva la condición `&&`). `setVideoReady(true)`
    // incondicional sobrevivía.
    it.each([
      ['width', 0, 480],
      ['height', 640, 0],
    ])('does not enable the shutter if loadedmetadata reports a zero %s', async (_axis, width, height) => {
      const { stream } = makeFakeStream();
      getUserMedia.mockResolvedValue(stream);
      render(<ManifestCameraSheet {...baseProps} />);
      await waitFor(() => expect(getUserMedia).toHaveBeenCalled());

      makeVideoReady(width, height);
      expect(screen.getByRole('button', { name: /capturar/i })).toBeDisabled();
    });

    // Ronda 3 — esto es defensa en profundidad sobre `handleShutter`
    // directamente, NO una simulación de "la pista terminó a mitad de
    // sesión": ningún navegador real vuelve `videoWidth`/`videoHeight` a 0
    // cuando una pista termina (ver M-A más abajo, que sí cubre ese caso
    // real con eventos de la pista).
    it('handleShutter itself refuses to capture if the video dimensions are ever zero at click time', async () => {
      const { stream } = makeFakeStream();
      getUserMedia.mockResolvedValue(stream);
      const onCapture = vi.fn();
      render(<ManifestCameraSheet {...baseProps} onCapture={onCapture} />);
      await waitFor(() => expect(getUserMedia).toHaveBeenCalled());

      const video = makeVideoReady(640, 480);
      await waitFor(() => expect(screen.getByRole('button', { name: /capturar/i })).not.toBeDisabled());

      // Force dimensions to 0 without another loadedmetadata event — the
      // button stays enabled (its own state doesn't know), but the click
      // handler must still refuse.
      Object.defineProperty(video, 'videoWidth', { value: 0, configurable: true });
      Object.defineProperty(video, 'videoHeight', { value: 0, configurable: true });

      fireEvent.click(screen.getByRole('button', { name: /capturar/i }));
      expect(onCapture).not.toHaveBeenCalled();
    });

    // Ronda 4 — el guard defensivo reducido a `videoWidth === 0` (sin el
    // `|| videoHeight === 0`) pasaba: el eje del alto no lo ejercitaba
    // ningún test de esta descripción (el anterior fuerza los dos a 0 a la
    // vez, que no distingue `||` de `&&` de un solo operando).
    it('handleShutter refuses to capture if only the height drops to zero at click time', async () => {
      const { stream } = makeFakeStream();
      getUserMedia.mockResolvedValue(stream);
      const onCapture = vi.fn();
      render(<ManifestCameraSheet {...baseProps} onCapture={onCapture} />);
      await waitFor(() => expect(getUserMedia).toHaveBeenCalled());

      const video = makeVideoReady(640, 480);
      await waitFor(() => expect(screen.getByRole('button', { name: /capturar/i })).not.toBeDisabled());

      Object.defineProperty(video, 'videoHeight', { value: 0, configurable: true });

      fireEvent.click(screen.getByRole('button', { name: /capturar/i }));
      expect(onCapture).not.toHaveBeenCalled();
    });
  });

  // M-A, ronda 3 de review del PR #713 — cuando la pista muere a mitad de
  // sesión, un navegador real NO pone las dimensiones del <video> a 0: se
  // queda congelado en el último frame. El único detector real es
  // escuchar el fin de la pista, no las dimensiones.
  describe('M-A — la pista puede morir sin que las dimensiones del <video> lo delaten', () => {
    it('disables the shutter again when the live track ends', async () => {
      const { stream, track } = makeFakeStream();
      getUserMedia.mockResolvedValue(stream);
      const onCapture = vi.fn();
      render(<ManifestCameraSheet {...baseProps} onCapture={onCapture} />);
      await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
      makeVideoReady();
      await waitFor(() => expect(screen.getByRole('button', { name: /capturar/i })).not.toBeDisabled());

      // Un navegador real fija readyState='ended' antes de disparar el evento.
      track.readyState = 'ended';
      act(() => track.dispatchEvent(new Event('ended')));

      await waitFor(() => expect(screen.getByRole('button', { name: /capturar/i })).toBeDisabled());
      fireEvent.click(screen.getByRole('button', { name: /capturar/i }));
      expect(onCapture).not.toHaveBeenCalled();
    });

    it('disables the shutter again when the live track mutes', async () => {
      const { stream, track } = makeFakeStream();
      getUserMedia.mockResolvedValue(stream);
      render(<ManifestCameraSheet {...baseProps} />);
      await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
      makeVideoReady();
      await waitFor(() => expect(screen.getByRole('button', { name: /capturar/i })).not.toBeDisabled());

      track.muted = true;
      act(() => track.dispatchEvent(new Event('mute')));

      await waitFor(() => expect(screen.getByRole('button', { name: /capturar/i })).toBeDisabled());
    });

    it('disables the shutter when the document is backgrounded (visibilitychange)', async () => {
      const { stream } = makeFakeStream();
      getUserMedia.mockResolvedValue(stream);
      render(<ManifestCameraSheet {...baseProps} />);
      await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
      makeVideoReady();
      await waitFor(() => expect(screen.getByRole('button', { name: /capturar/i })).not.toBeDisabled());

      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      act(() => document.dispatchEvent(new Event('visibilitychange')));

      await waitFor(() => expect(screen.getByRole('button', { name: /capturar/i })).toBeDisabled());

      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    });

    // Bloqueante, ronda 4 de review del PR #713 — los dos detectores
    // anteriores no tenían su contrario: `visibilitychange` sólo tenía la
    // rama `hidden` y `loadedmetadata` no vuelve a disparar al recuperar el
    // foco (es de una vez por carga), así que el obturador se quedaba
    // deshabilitado PARA SIEMPRE tras volver de segundo plano — el operario
    // ve el visor moviéndose de nuevo pero el botón queda gris, sin ninguna
    // pista visual de por qué. Verificado con el mutante que el propio
    // reviewer señaló: `setVideoReady(false)` incondicional en el handler
    // de `visibilitychange` sobrevivía a la suite completa porque nada
    // ejercitaba la vuelta a `visible`.
    it('re-enables the shutter when the document becomes visible again, if the frame is still real', async () => {
      const { stream } = makeFakeStream();
      getUserMedia.mockResolvedValue(stream);
      render(<ManifestCameraSheet {...baseProps} />);
      await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
      makeVideoReady();
      await waitFor(() => expect(screen.getByRole('button', { name: /capturar/i })).not.toBeDisabled());

      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      await waitFor(() => expect(screen.getByRole('button', { name: /capturar/i })).toBeDisabled());

      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      act(() => document.dispatchEvent(new Event('visibilitychange')));

      await waitFor(() => expect(screen.getByRole('button', { name: /capturar/i })).not.toBeDisabled());
    });

    // La misma reversibilidad para `mute`: iOS silencia la pista en una
    // interrupción (llamada, bloqueo de pantalla) y la devuelve viva con
    // `unmute` al recuperar el foco — sin el listener de `unmute`, el visor
    // vuelve a moverse pero el botón se queda gris.
    it('re-enables the shutter when the track unmutes after an interruption', async () => {
      const { stream, track } = makeFakeStream();
      getUserMedia.mockResolvedValue(stream);
      render(<ManifestCameraSheet {...baseProps} />);
      await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
      makeVideoReady();
      await waitFor(() => expect(screen.getByRole('button', { name: /capturar/i })).not.toBeDisabled());

      track.muted = true;
      act(() => track.dispatchEvent(new Event('mute')));
      await waitFor(() => expect(screen.getByRole('button', { name: /capturar/i })).toBeDisabled());

      track.muted = false;
      act(() => track.dispatchEvent(new Event('unmute')));

      await waitFor(() => expect(screen.getByRole('button', { name: /capturar/i })).not.toBeDisabled());
    });

    // Ronda 4 — `ended` debe engancharse también a un segundo stream tras
    // un ciclo open true→false→true, no sólo al primero.
    it('detects ended on the second stream after an open close/reopen cycle', async () => {
      const { stream: stream1 } = makeFakeStream();
      const { stream: stream2, track: track2 } = makeFakeStream();
      getUserMedia.mockResolvedValueOnce(stream1).mockResolvedValueOnce(stream2);
      const { rerender } = render(<ManifestCameraSheet {...baseProps} open />);
      await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));

      rerender(<ManifestCameraSheet {...baseProps} open={false} />);
      rerender(<ManifestCameraSheet {...baseProps} open />);
      await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
      makeVideoReady();
      await waitFor(() => expect(screen.getByRole('button', { name: /capturar/i })).not.toBeDisabled());

      track2.readyState = 'ended';
      act(() => track2.dispatchEvent(new Event('ended')));

      await waitFor(() => expect(screen.getByRole('button', { name: /capturar/i })).toBeDisabled());
    });

    // Menores, ronda 4 — sin esto, quitar el `removeEventListener`/
    // `trackCleanupFns.forEach` de la limpieza deja la suite en verde: hoy
    // el código es correcto (medido), pero nada lo protegía de la próxima
    // refactorización.
    it('removes exactly the visibilitychange listener it added, once, on teardown', async () => {
      const addSpy = vi.spyOn(document, 'addEventListener');
      const removeSpy = vi.spyOn(document, 'removeEventListener');
      const { stream } = makeFakeStream();
      getUserMedia.mockResolvedValue(stream);
      const { unmount } = render(<ManifestCameraSheet {...baseProps} />);
      await waitFor(() => expect(getUserMedia).toHaveBeenCalled());

      const addCalls = addSpy.mock.calls.filter((c) => c[0] === 'visibilitychange').length;
      expect(addCalls).toBe(1);

      unmount();

      const removeCalls = removeSpy.mock.calls.filter((c) => c[0] === 'visibilitychange').length;
      expect(removeCalls).toBe(1);
      addSpy.mockRestore();
      removeSpy.mockRestore();
    });

    it('removes the ended/mute/unmute listeners from the track it attached them to on teardown', async () => {
      const { stream, track } = makeFakeStream();
      getUserMedia.mockResolvedValue(stream);
      const removeSpy = vi.spyOn(track, 'removeEventListener');
      const { unmount } = render(<ManifestCameraSheet {...baseProps} />);
      await waitFor(() => expect(getUserMedia).toHaveBeenCalled());

      unmount();

      expect(removeSpy.mock.calls.map((c) => c[0]).sort()).toEqual(['ended', 'mute', 'unmute']);
    });

    // getVideoTracks() → getTracks() sobrevivía: con un stream cuyos dos
    // métodos devuelven tracks DISTINTOS, sólo el de getVideoTracks() debe
    // recibir los listeners de encuadre.
    it('attaches the ended/mute listeners via getVideoTracks(), not getTracks()', async () => {
      const videoTrack = new FakeTrack();
      const nonVideoTrack = new FakeTrack();
      const stream = {
        getTracks: () => [nonVideoTrack],
        getVideoTracks: () => [videoTrack],
      } as unknown as MediaStream;
      getUserMedia.mockResolvedValue(stream);
      render(<ManifestCameraSheet {...baseProps} />);
      await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
      makeVideoReady();
      await waitFor(() => expect(screen.getByRole('button', { name: /capturar/i })).not.toBeDisabled());

      videoTrack.readyState = 'ended';
      act(() => videoTrack.dispatchEvent(new Event('ended')));

      await waitFor(() => expect(screen.getByRole('button', { name: /capturar/i })).toBeDisabled());
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

    // B2, ronda 3 de review del PR #713 (bloqueante) — el efecto ya
    // liberaba el stream con open=false, pero el JSX nunca lo consultaba:
    // quedaba un overlay `fixed inset-0 z-50` negro, con
    // `aria-modal="true"`, tapando la PWA entera con "Listo" y una X.
    it('renders nothing while open=false — no dialog, no "Listo", no framing caption', async () => {
      render(<ManifestCameraSheet {...baseProps} open={false} />);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.queryByText('Listo')).not.toBeInTheDocument();
      expect(
        screen.queryByText('Encuadra la hoja completa, con la firma visible')
      ).not.toBeInTheDocument();
    });

    // Menor, ronda 3 — quitar `setVideoReady(false)` de la limpieza del
    // efecto sobrevivía: el estado de React persiste entre renders aunque
    // el JSX devuelva `null` (no es un desmontaje), así que sin el reset
    // explícito el obturador seguiría "listo" del stream anterior al
    // reabrir, antes de que el nuevo stream tenga ningún frame real.
    it('does not leave the shutter enabled when reopened — videoReady resets on teardown', async () => {
      const { stream: stream1 } = makeFakeStream();
      getUserMedia.mockResolvedValueOnce(stream1);
      const { rerender } = render(<ManifestCameraSheet {...baseProps} open />);
      await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
      makeVideoReady();
      await waitFor(() => expect(screen.getByRole('button', { name: /capturar/i })).not.toBeDisabled());

      rerender(<ManifestCameraSheet {...baseProps} open={false} />);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      const { stream: stream2 } = makeFakeStream();
      getUserMedia.mockResolvedValueOnce(stream2);
      rerender(<ManifestCameraSheet {...baseProps} open />);
      await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));

      expect(screen.getByRole('button', { name: /capturar/i })).toBeDisabled();
    });
  });

  // M4, ronda 3 de review del PR #713 — "role=dialog en 5g ... sobreviven,
  // lo que entregaste como M4 no tiene un solo test."
  it('exposes itself as a dialog with an aria-modal label', async () => {
    const { stream } = makeFakeStream();
    getUserMedia.mockResolvedValue(stream);
    render(<ManifestCameraSheet {...baseProps} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Hoja 3 de CARGA-99814');
  });

  it('disables the shutter button once it has fallen back to the file input', async () => {
    // @ts-expect-error - simulate a browser/PWA without camera stream support
    delete global.navigator.mediaDevices;
    render(<ManifestCameraSheet {...baseProps} />);
    await screen.findByTestId('manifest-camera-fallback-input');
    expect(screen.getByRole('button', { name: /capturar/i })).toBeDisabled();
  });

  // Ronda 3 de review del PR #713 — la leyenda de encuadre vivía fuera del
  // ternario y se pintaba encima del mensaje de error del fallback (ambos
  // `absolute ... bottom-[26px]`). Sólo tiene sentido junto al visor en vivo.
  it('does not show the live-viewfinder caption while showing the fallback tile', async () => {
    // @ts-expect-error - simulate a browser/PWA without camera stream support
    delete global.navigator.mediaDevices;
    render(<ManifestCameraSheet {...baseProps} />);
    await screen.findByTestId('manifest-camera-fallback-input');
    expect(
      screen.queryByText('Encuadra la hoja completa, con la firma visible')
    ).not.toBeInTheDocument();
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

  // Menor, ronda 3 de review del PR #713 — accept="image/*" → "*/*" sobrevivía.
  it('sets accept="image/*" on the fallback input', async () => {
    // @ts-expect-error - simulate a browser/PWA without camera stream support
    delete global.navigator.mediaDevices;
    render(<ManifestCameraSheet {...baseProps} />);
    const input = await screen.findByTestId('manifest-camera-fallback-input');
    expect(input).toHaveAttribute('accept', 'image/*');
  });

  // M-B, ronda 3 de review del PR #713 — smoke test end-to-end del wiring
  // a validateManifestPhotoFile; los casos exhaustivos viven en
  // lib/pickup/manifestPhotoValidation.test.ts.
  it('accepts a fallback file with an empty type but a recognizable extension (Android WebView quirk)', async () => {
    // @ts-expect-error - simulate a browser/PWA without camera stream support
    delete global.navigator.mediaDevices;
    const onCapture = vi.fn();
    render(<ManifestCameraSheet {...baseProps} onCapture={onCapture} />);
    const input = await screen.findByTestId('manifest-camera-fallback-input');

    const noType = new File(['data'], 'IMG_0001.JPG', { type: '' });
    fireEvent.change(input, { target: { files: [noType] } });

    expect(onCapture).toHaveBeenCalledOnce();
    const file = onCapture.mock.calls[0][0] as File;
    expect(file.type).toBe('image/jpeg');
  });

  // Fase 9, spec-95 — `5g` dibuja el botón de flash arriba a la derecha,
  // pero sólo donde el dispositivo real lo soporta. La capacidad se lee de
  // `track.getCapabilities().torch`, nunca del user-agent.
  describe('flash — degrada en silencio donde el dispositivo no lo soporta', () => {
    it('shows the flash button when the live track reports torch capability', async () => {
      const { stream } = makeFakeStream({ torch: true });
      getUserMedia.mockResolvedValue(stream);
      render(<ManifestCameraSheet {...baseProps} />);
      await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
      expect(await screen.findByRole('button', { name: /flash/i })).toBeInTheDocument();
    });

    // B1, bloqueante del review de 6817496 — el caso decisivo: la mayoría
    // de las cámaras reales declaran `torch: false` explícito (frontal de
    // Android, webcam de escritorio), no lo omiten. `{}` sin esa clave por
    // sí solo no distingue una implementación correcta de una que trataba
    // "la clave existe" como soporte.
    it('does NOT render the flash button when the track reports torch: false', async () => {
      const { stream } = makeFakeStream({ torch: false });
      getUserMedia.mockResolvedValue(stream);
      render(<ManifestCameraSheet {...baseProps} />);
      await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
      await waitFor(() => expect(screen.getByTestId('manifest-camera-video')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: /flash/i })).not.toBeInTheDocument();
    });

    it('does not render the flash button when the track capabilities do not include torch at all', async () => {
      const { stream } = makeFakeStream({});
      getUserMedia.mockResolvedValue(stream);
      render(<ManifestCameraSheet {...baseProps} />);
      await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
      // dar tiempo a que, si el botón fuera a aparecer, ya lo hubiera hecho
      await waitFor(() => expect(screen.getByTestId('manifest-camera-video')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: /flash/i })).not.toBeInTheDocument();
    });

    it('does not render the flash button, and does not throw, when the track has no getCapabilities method at all', async () => {
      const { stream } = makeStreamWithBareTrack();
      getUserMedia.mockResolvedValue(stream);
      render(<ManifestCameraSheet {...baseProps} />);
      await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
      await waitFor(() => expect(screen.getByTestId('manifest-camera-video')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: /flash/i })).not.toBeInTheDocument();
    });

    it('never shows the flash button while showing the native-file fallback', async () => {
      // @ts-expect-error - simulate a browser/PWA without camera stream support
      delete global.navigator.mediaDevices;
      render(<ManifestCameraSheet {...baseProps} />);
      await screen.findByTestId('manifest-camera-fallback-input');
      expect(screen.queryByRole('button', { name: /flash/i })).not.toBeInTheDocument();
    });

    // "arriba a la derecha" de `5g` — el atributo que produce esa posición
    // dentro del header flex, no sólo que el botón exista en el DOM.
    it('positions the flash button at the far right of the header (ml-auto)', async () => {
      const { stream } = makeFakeStream({ torch: true });
      getUserMedia.mockResolvedValue(stream);
      render(<ManifestCameraSheet {...baseProps} />);
      const button = await screen.findByRole('button', { name: /flash/i });
      expect(button.className).toContain('ml-auto');
    });

    // B2, bloqueante del review de 6817496 — el constraint va SIN envolver
    // en `advanced` (eso es best-effort y resuelve aunque el UA lo salte).
    it('toggles the torch via a bare { torch } constraint, and its pressed/icon state, on each click', async () => {
      const { stream, track } = makeFakeStream({ torch: true });
      getUserMedia.mockResolvedValue(stream);
      render(<ManifestCameraSheet {...baseProps} />);
      const button = await screen.findByRole('button', { name: /flash/i });
      expect(button).toHaveAttribute('aria-pressed', 'false');
      expect(button.querySelector('svg')).toHaveAttribute('fill', 'none');

      fireEvent.click(button);
      await waitFor(() => expect(track.applyConstraints).toHaveBeenCalledWith({ torch: true }));
      await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'));
      expect(button.querySelector('svg')).toHaveAttribute('fill', 'currentColor');

      fireEvent.click(button);
      await waitFor(() => expect(track.applyConstraints).toHaveBeenCalledWith({ torch: false }));
      await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'false'));
      expect(button.querySelector('svg')).toHaveAttribute('fill', 'none');
    });

    it('does not flip aria-pressed if the real device rejects the constraint', async () => {
      const { stream, track } = makeFakeStream({ torch: true });
      track.applyConstraints = vi.fn().mockRejectedValue(new Error('OverconstrainedError'));
      getUserMedia.mockResolvedValue(stream);
      render(<ManifestCameraSheet {...baseProps} />);
      const button = await screen.findByRole('button', { name: /flash/i });

      fireEvent.click(button);
      await waitFor(() => expect(track.applyConstraints).toHaveBeenCalledOnce());
      expect(button).toHaveAttribute('aria-pressed', 'false');
    });

    // Mutante superviviente (review 6817496): `if (!track?.applyConstraints)`
    // → `if (!track)` — defensa muerta si nada la ejercita.
    it('does not throw when clicked against a track that has no applyConstraints method', async () => {
      const { stream, track } = makeFakeStream({ torch: true });
      getUserMedia.mockResolvedValue(stream);
      render(<ManifestCameraSheet {...baseProps} />);
      const button = await screen.findByRole('button', { name: /flash/i });

      // El track real queda sin `applyConstraints` (dispositivo/navegador
      // que sólo expone la lectura de capacidades, no el control).
      // @ts-expect-error - simular un track sin applyConstraints
      delete track.applyConstraints;

      expect(() => fireEvent.click(button)).not.toThrow();
    });

    // M1 del review — la pista se puede caer con el flash encendido.
    describe('M1 — la pista se cae con el flash encendido', () => {
      it('turns the flash off, but keeps the button, when the track mutes', async () => {
        const { stream, track } = makeFakeStream({ torch: true });
        getUserMedia.mockResolvedValue(stream);
        render(<ManifestCameraSheet {...baseProps} />);
        const button = await screen.findByRole('button', { name: /flash/i });
        fireEvent.click(button);
        await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'));

        track.muted = true;
        act(() => track.dispatchEvent(new Event('mute')));

        await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'false'));
        expect(screen.getByRole('button', { name: /flash/i })).toBeInTheDocument();
      });

      it('turns the flash off AND removes the button when the track ends for good', async () => {
        const { stream, track } = makeFakeStream({ torch: true });
        getUserMedia.mockResolvedValue(stream);
        render(<ManifestCameraSheet {...baseProps} />);
        const button = await screen.findByRole('button', { name: /flash/i });
        fireEvent.click(button);
        await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'));

        track.readyState = 'ended';
        act(() => track.dispatchEvent(new Event('ended')));

        await waitFor(() =>
          expect(screen.queryByRole('button', { name: /flash/i })).not.toBeInTheDocument()
        );
      });
    });

    // Mutante superviviente (review 6817496): borrar el reset de torch en
    // la limpieza del efecto sobrevivía — nada probaba que no había fuga
    // entre una apertura con soporte y una reapertura sin él.
    // `registerTrack` en la reapertura YA vuelve a fijar `torchSupported`
    // desde la capacidad del stream nuevo, así que un segundo stream SIN
    // torch no distingue "hay reset" de "no lo hay" — habría enmascarado
    // este mutante. `torchOn` es la señal limpia: `registerTrack` nunca la
    // toca, sólo `reset()` en la limpieza del efecto. Por eso el segundo
    // stream vuelve a soportar torch (mismo botón, mismo capabilities) y
    // se comprueba `aria-pressed` SIN volver a tocarlo.
    it('does not leak torchOn across an open/close/open cycle, even when the reopened track supports torch again', async () => {
      const { stream: stream1 } = makeFakeStream({ torch: true });
      getUserMedia.mockResolvedValueOnce(stream1);
      const { rerender } = render(<ManifestCameraSheet {...baseProps} open />);
      const button = await screen.findByRole('button', { name: /flash/i });
      fireEvent.click(button);
      await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'));

      rerender(<ManifestCameraSheet {...baseProps} open={false} />);

      const { stream: stream2 } = makeFakeStream({ torch: true });
      getUserMedia.mockResolvedValueOnce(stream2);
      rerender(<ManifestCameraSheet {...baseProps} open />);
      await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));

      const reopenedButton = await screen.findByRole('button', { name: /flash/i });
      expect(reopenedButton).toHaveAttribute('aria-pressed', 'false');
    });

    it('does not leak torchSupported across an open/close/open cycle when the reopened track has no torch', async () => {
      const { stream: stream1 } = makeFakeStream({ torch: true });
      getUserMedia.mockResolvedValueOnce(stream1);
      const { rerender } = render(<ManifestCameraSheet {...baseProps} open />);
      await screen.findByRole('button', { name: /flash/i });

      rerender(<ManifestCameraSheet {...baseProps} open={false} />);

      const { stream: stream2 } = makeFakeStream({});
      getUserMedia.mockResolvedValueOnce(stream2);
      rerender(<ManifestCameraSheet {...baseProps} open />);
      await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.getByTestId('manifest-camera-video')).toBeInTheDocument());

      expect(screen.queryByRole('button', { name: /flash/i })).not.toBeInTheDocument();
    });
  });
});
