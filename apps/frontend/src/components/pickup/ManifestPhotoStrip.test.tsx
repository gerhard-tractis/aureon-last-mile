import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ManifestPhotoStrip } from './ManifestPhotoStrip';

/**
 * spec-80 fase 6 — cablea `5g`/`5h` (`ManifestCameraSheet`/`PhotoReviewSheet`,
 * fase 4, mergeadas en #713) a `enqueueManifestPhoto` (`lib/offline/photos.ts`,
 * spec-81 fase 5, mergeada) en vez de `useUploadManifestDocument` (la ruta
 * online directa, sin salida sin señal). Ambas pantallas de captura ya están
 * cubiertas por su propio test — aquí se sustituyen por dobles mínimos que
 * disparan los mismos callbacks (`onCapture`/`onUsePhoto`/etc.) para probar
 * el cableado, no la cámara en sí.
 */

const mockUseManifestDocuments = vi.fn();
vi.mock('@/hooks/pickup/useManifestDocuments', () => ({
  useManifestDocuments: (...args: unknown[]) => mockUseManifestDocuments(...args),
}));

const mockEnqueueManifestPhoto = vi.fn();
vi.mock('@/lib/offline/photos', () => ({
  enqueueManifestPhoto: (...args: unknown[]) => mockEnqueueManifestPhoto(...args),
}));

vi.mock('@/lib/db', () => ({ db: { pickup_queue: {} } }));

const mockToastError = vi.fn();
const mockToastSuccess = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
  },
}));

// Dobles mínimos de 5g/5h: cada uno expone un botón por callback relevante,
// para disparar exactamente lo que la cámara/revisión reales dispararían,
// sin repetir su propia suite (ManifestCameraSheet.test.tsx/PhotoReviewSheet.test.tsx).
let latestCameraProps: Record<string, unknown> = {};
vi.mock('./ManifestCameraSheet', () => ({
  ManifestCameraSheet: (props: Record<string, unknown>) => {
    latestCameraProps = props;
    if (!props.open) return null;
    return (
      <div data-testid="camera-sheet">
        <span data-testid="camera-load-label">{String(props.loadLabel)}</span>
        <span data-testid="camera-sheet-number">{String(props.sheetNumber)}</span>
        <span data-testid="camera-captured-count">{String(props.capturedCount)}</span>
        <button
          type="button"
          data-testid="camera-capture-button"
          onClick={() =>
            (props.onCapture as (file: File) => void)(
              new File(['jpeg-bytes'], 'sheet-3.jpg', { type: 'image/jpeg' })
            )
          }
        >
          Capturar
        </button>
        <button type="button" data-testid="camera-done-button" onClick={props.onDone as () => void}>
          Listo
        </button>
      </div>
    );
  },
}));

let latestReviewProps: Record<string, unknown> | null = null;
vi.mock('./PhotoReviewSheet', () => ({
  PhotoReviewSheet: (props: Record<string, unknown>) => {
    latestReviewProps = props;
    return (
      <div data-testid="review-sheet">
        <span data-testid="review-is-saving">{String(Boolean(props.isSaving))}</span>
        <span data-testid="review-load-label">{String(props.loadLabel)}</span>
        <span data-testid="review-sheet-number">{String(props.sheetNumber)}</span>
        <button
          type="button"
          data-testid="review-use-photo-button"
          onClick={() => (props.onUsePhoto as (file: File) => void)(props.photo as File)}
        >
          Usar foto
        </button>
        <button type="button" data-testid="review-retake-button" onClick={props.onRetake as () => void}>
          Repetir
        </button>
      </div>
    );
  },
}));

describe('ManifestPhotoStrip', () => {
  beforeEach(() => {
    mockUseManifestDocuments.mockReset();
    mockEnqueueManifestPhoto.mockReset();
    mockEnqueueManifestPhoto.mockResolvedValue({ id: 1 });
    mockToastError.mockReset();
    mockToastSuccess.mockReset();
    latestCameraProps = {};
    latestReviewProps = null;
  });

  it('shows the mock heading and subtitle', () => {
    mockUseManifestDocuments.mockReturnValue({ data: [], isFetching: false });
    render(<ManifestPhotoStrip operatorId="op-1" manifestId="manifest-1" userId="user-1" />);
    expect(screen.getByText('FOTOS DEL MANIFIESTO FIRMADO')).toBeInTheDocument();
    expect(
      screen.getByText('Fotografía el papel firmado por el local. Es el respaldo si después falta un paquete.')
    ).toBeInTheDocument();
  });

  it('renders a count of 0 and only the Agregar tile when there are no photos', () => {
    mockUseManifestDocuments.mockReturnValue({ data: [], isFetching: false });
    render(<ManifestPhotoStrip operatorId="op-1" manifestId="manifest-1" userId="user-1" />);
    expect(screen.getByTestId('manifest-photo-count')).toHaveTextContent('0');
    expect(screen.getByText('Agregar')).toBeInTheDocument();
    expect(screen.queryByText('hoja 1')).not.toBeInTheDocument();
  });

  it('renders one tile per captured sheet, labelled "hoja N", plus the count', () => {
    mockUseManifestDocuments.mockReturnValue({
      data: [
        { id: 'doc-1', storage_path: 'op-1/manifest-1/sheet-1.jpg', sheet_number: 1, captured_at: '2026-09-08T09:00:00Z' },
        { id: 'doc-2', storage_path: 'op-1/manifest-1/sheet-2.jpg', sheet_number: 2, captured_at: '2026-09-08T09:01:00Z' },
      ],
      isFetching: false,
    });
    render(<ManifestPhotoStrip operatorId="op-1" manifestId="manifest-1" userId="user-1" />);
    expect(screen.getByTestId('manifest-photo-count')).toHaveTextContent('2');
    expect(screen.getByText('hoja 1')).toBeInTheDocument();
    expect(screen.getByText('hoja 2')).toBeInTheDocument();
  });

  it('does not render an Agregar tile the operator can act on when manifestId is missing', () => {
    mockUseManifestDocuments.mockReturnValue({ data: [], isFetching: false });
    render(<ManifestPhotoStrip operatorId="op-1" manifestId={null} userId="user-1" />);
    expect(screen.getByRole('button', { name: /agregar/i })).toBeDisabled();
  });

  it('mounts ManifestCameraSheet closed until Agregar is pressed, then opens it at MAX(sheet_number)+1', () => {
    mockUseManifestDocuments.mockReturnValue({
      data: [{ id: 'doc-1', storage_path: 'x', sheet_number: 1, captured_at: 't' }],
      isFetching: false,
    });
    render(
      <ManifestPhotoStrip
        operatorId="op-1"
        manifestId="manifest-1"
        userId="user-1"
        externalLoadId="CARGA-99814"
      />
    );

    // Ronda del PR #713 (M1/B2) — ManifestCameraSheet debe montarse SIEMPRE
    // (convención open/onOpenChange), nunca envuelta en `{cameraOpen && ...}`.
    expect(latestCameraProps.open).toBe(false);
    expect(screen.queryByTestId('camera-sheet')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /agregar/i }));

    expect(latestCameraProps.open).toBe(true);
    expect(screen.getByTestId('camera-sheet-number')).toHaveTextContent('2');
    expect(screen.getByTestId('camera-load-label')).toHaveTextContent('CARGA-99814');
    // Ronda 2 de review del PR #736 (M2c) — "YA CAPTURADAS · N" en 5g debe
    // reflejar cuántas hojas hay, no un valor fijo.
    expect(screen.getByTestId('camera-captured-count')).toHaveTextContent('1');
  });

  // Ronda 2 de review del PR #736 (M2d) — el botón "Listo" de la cámara
  // (`onDone`) debe cerrarla sin pasar por la revisión.
  it('closes the camera without opening the review sheet when 5g reports "Listo" (onDone)', () => {
    mockUseManifestDocuments.mockReturnValue({ data: [], isFetching: false });
    render(<ManifestPhotoStrip operatorId="op-1" manifestId="manifest-1" userId="user-1" />);

    fireEvent.click(screen.getByRole('button', { name: /agregar/i }));
    expect(latestCameraProps.open).toBe(true);

    fireEvent.click(screen.getByTestId('camera-done-button'));

    expect(latestCameraProps.open).toBe(false);
    expect(screen.queryByTestId('review-sheet')).not.toBeInTheDocument();
  });

  // Seguimiento — mismo caso que el suite anterior cubría contra
  // `useUploadManifestDocument` (hoja 1 borrada, sólo queda hoja 2 viva):
  // `documents.length+1` daría 2 (colisión); `MAX(sheet_number)+1` da 3.
  it('uses MAX(sheet_number)+1 (not length+1) when a gap exists, opening the camera at the right sheet, and carries the same number into the review sheet', () => {
    mockUseManifestDocuments.mockReturnValue({
      data: [{ id: 'doc-2', storage_path: 'x', sheet_number: 2, captured_at: 't' }],
      isFetching: false,
    });
    render(<ManifestPhotoStrip operatorId="op-1" manifestId="manifest-1" userId="user-1" />);

    fireEvent.click(screen.getByRole('button', { name: /agregar/i }));
    expect(screen.getByTestId('camera-sheet-number')).toHaveTextContent('3');

    fireEvent.click(screen.getByTestId('camera-capture-button'));
    expect(screen.getByTestId('review-sheet-number')).toHaveTextContent('3');
  });

  it('opens PhotoReviewSheet with the captured File after 5g captures a frame, and closes the camera', () => {
    mockUseManifestDocuments.mockReturnValue({ data: [], isFetching: false });
    render(
      <ManifestPhotoStrip
        operatorId="op-1"
        manifestId="manifest-1"
        userId="user-1"
        externalLoadId="CARGA-99814"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /agregar/i }));
    fireEvent.click(screen.getByTestId('camera-capture-button'));

    expect(latestCameraProps.open).toBe(false);
    expect(screen.getByTestId('review-sheet')).toBeInTheDocument();
    expect((latestReviewProps!.photo as File).name).toBe('sheet-3.jpg');
    expect(screen.getByTestId('review-load-label')).toHaveTextContent('CARGA-99814');
  });

  it('calls enqueueManifestPhoto (not useUploadManifestDocument) with the File as the blob, including externalLoadId', async () => {
    mockUseManifestDocuments.mockReturnValue({ data: [], isFetching: false });
    render(
      <ManifestPhotoStrip
        operatorId="op-1"
        manifestId="manifest-1"
        userId="user-1"
        externalLoadId="CARGA-99814"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /agregar/i }));
    fireEvent.click(screen.getByTestId('camera-capture-button'));
    fireEvent.click(screen.getByTestId('review-use-photo-button'));

    await waitFor(() => expect(mockEnqueueManifestPhoto).toHaveBeenCalledOnce());
    const [, input] = mockEnqueueManifestPhoto.mock.calls[0];
    expect(input).toEqual(
      expect.objectContaining({
        operatorId: 'op-1',
        manifestId: 'manifest-1',
        userId: 'user-1',
        externalLoadId: 'CARGA-99814',
        sheetNumber: 1,
      })
    );
    // Un File ES un Blob — encaja sin reconversión.
    expect(input.blob).toBeInstanceOf(File);
    expect((input.blob as File).name).toBe('sheet-3.jpg');
  });

  // Ronda 2 de review del PR #736 (M2b, bloqueante) — el test de arriba usa
  // `documents=[]`, donde la respuesta correcta (`nextSheetNumber`) Y un
  // `sheetNumber: 1` fijo dan lo mismo: un mutante que reemplazara
  // `nextSheetNumber` por `1` sobrevivía. Con un hueco (sólo la hoja 2 viva)
  // el valor correcto es 3 — distinto de cualquier constante fija.
  it('calls enqueueManifestPhoto with the real nextSheetNumber, not a fixed value, when a gap exists', async () => {
    mockUseManifestDocuments.mockReturnValue({
      data: [{ id: 'doc-2', storage_path: 'x', sheet_number: 2, captured_at: 't' }],
      isFetching: false,
    });
    render(<ManifestPhotoStrip operatorId="op-1" manifestId="manifest-1" userId="user-1" />);

    fireEvent.click(screen.getByRole('button', { name: /agregar/i }));
    fireEvent.click(screen.getByTestId('camera-capture-button'));
    fireEvent.click(screen.getByTestId('review-use-photo-button'));

    await waitFor(() => expect(mockEnqueueManifestPhoto).toHaveBeenCalledOnce());
    const [, input] = mockEnqueueManifestPhoto.mock.calls[0];
    expect(input).toEqual(expect.objectContaining({ sheetNumber: 3 }));
  });

  it('closes the review sheet, shows a success toast, and re-enables Agregar after a successful enqueue', async () => {
    mockUseManifestDocuments.mockReturnValue({ data: [], isFetching: false });
    render(<ManifestPhotoStrip operatorId="op-1" manifestId="manifest-1" userId="user-1" />);

    fireEvent.click(screen.getByRole('button', { name: /agregar/i }));
    fireEvent.click(screen.getByTestId('camera-capture-button'));
    fireEvent.click(screen.getByTestId('review-use-photo-button'));

    await waitFor(() => expect(screen.queryByTestId('review-sheet')).not.toBeInTheDocument());

    // Ronda 2 de review del PR #736 (M3) — sin señal, "0 fotos" en la tira
    // no cambia entre la primera y la segunda captura (cuenta sólo lo que el
    // servidor confirmó): este toast es la única confirmación que el
    // operario recibe de que la hoja anterior no se perdió.
    // Ronda 3 de review del PR #736 — el mensaje ya no se gatea por
    // conectividad (ver el spec): "Foto guardada" es cierto en los dos
    // caminos, porque `enqueueManifestPhoto` es hoy la única ruta.
    expect(mockToastSuccess).toHaveBeenCalledWith('Foto guardada. Se sube sola.');

    // Ronda 2 de review del PR #736 (M2a, bloqueante) — sin
    // `setIsSaving(false)` en el `finally`, "Agregar" quedaba deshabilitado
    // para siempre tras la primera foto: nadie podía fotografiar la hoja 2
    // de un manifiesto normal de dos hojas. El test anterior sólo comprobaba
    // deshabilitado DURANTE el vuelo, nunca que se re-habilitara después.
    expect(screen.getByRole('button', { name: /agregar/i })).not.toBeDisabled();
  });

  it('disables Agregar and marks the review sheet as saving while enqueueManifestPhoto is in flight', async () => {
    mockUseManifestDocuments.mockReturnValue({ data: [], isFetching: false });
    let resolveEnqueue: (value: { id: number }) => void;
    mockEnqueueManifestPhoto.mockReturnValue(
      new Promise((resolve) => {
        resolveEnqueue = resolve;
      })
    );
    render(<ManifestPhotoStrip operatorId="op-1" manifestId="manifest-1" userId="user-1" />);

    fireEvent.click(screen.getByRole('button', { name: /agregar/i }));
    fireEvent.click(screen.getByTestId('camera-capture-button'));
    fireEvent.click(screen.getByTestId('review-use-photo-button'));

    await waitFor(() => expect(screen.getByTestId('review-is-saving')).toHaveTextContent('true'));
    expect(screen.getByRole('button', { name: /agregar/i })).toBeDisabled();

    resolveEnqueue!({ id: 1 });
    await waitFor(() => expect(screen.queryByTestId('review-sheet')).not.toBeInTheDocument());
  });

  it('retaking a photo re-opens the camera and discards the reviewed file', () => {
    mockUseManifestDocuments.mockReturnValue({ data: [], isFetching: false });
    render(<ManifestPhotoStrip operatorId="op-1" manifestId="manifest-1" userId="user-1" />);

    fireEvent.click(screen.getByRole('button', { name: /agregar/i }));
    fireEvent.click(screen.getByTestId('camera-capture-button'));
    fireEvent.click(screen.getByTestId('review-retake-button'));

    expect(screen.queryByTestId('review-sheet')).not.toBeInTheDocument();
    expect(latestCameraProps.open).toBe(true);
  });

  it('shows a Spanish, actionable error and keeps the review sheet open when enqueueing fails', async () => {
    mockUseManifestDocuments.mockReturnValue({ data: [], isFetching: false });
    mockEnqueueManifestPhoto.mockRejectedValueOnce(
      new Error('la foto supera el tamaño máximo (10 MiB) que el bucket admite — repite la captura antes de continuar')
    );
    render(<ManifestPhotoStrip operatorId="op-1" manifestId="manifest-1" userId="user-1" />);

    fireEvent.click(screen.getByRole('button', { name: /agregar/i }));
    fireEvent.click(screen.getByTestId('camera-capture-button'));
    fireEvent.click(screen.getByTestId('review-use-photo-button'));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledOnce());
    expect(mockToastError.mock.calls[0][0]).toContain('la foto supera el tamaño máximo');
    expect(screen.getByTestId('review-sheet')).toBeInTheDocument();
    // Ronda 3 de review del PR #736 — no bastaba con comprobar el
    // `toast.error`: sin esta línea, mover `toast.success(...)` a la
    // PRIMERA sentencia del `catch` (en vez de dejarlo sólo en el camino de
    // éxito) seguía en verde. Hoy el `throw` salta esa línea porque nunca
    // llega a ejecutarse — pero nada lo afirmaba. Falsa confirmación de
    // "foto guardada" sobre una foto rechazada por tamaño sería justo el
    // tipo de fallo que esta fase existe para no repetir.
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });
});
