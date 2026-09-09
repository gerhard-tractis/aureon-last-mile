import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ManifestPhotoStrip } from './ManifestPhotoStrip';

const mockUseManifestDocuments = vi.fn();
const mockMutateAsync = vi.fn();
const mockUseUploadManifestDocument = vi.fn();

vi.mock('@/hooks/pickup/useManifestDocuments', () => ({
  useManifestDocuments: (...args: unknown[]) => mockUseManifestDocuments(...args),
  useUploadManifestDocument: (...args: unknown[]) => mockUseUploadManifestDocument(...args),
}));

const mockToastError = vi.fn();
vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args) },
}));

const makeFile = (name = 'sheet.jpg') => new File(['data'], name, { type: 'image/jpeg' });

describe('ManifestPhotoStrip', () => {
  beforeEach(() => {
    mockUseManifestDocuments.mockReset();
    mockMutateAsync.mockReset();
    mockMutateAsync.mockResolvedValue(undefined);
    mockUseUploadManifestDocument.mockReset();
    mockUseUploadManifestDocument.mockReturnValue({ mutateAsync: mockMutateAsync, isPending: false });
    mockToastError.mockReset();
  });

  it('shows the mock heading and subtitle', () => {
    mockUseManifestDocuments.mockReturnValue({ data: [], isLoading: false, isFetching: false });
    render(
      <ManifestPhotoStrip operatorId="op-1" manifestId="manifest-1" userId="user-1" />
    );
    expect(screen.getByText('FOTOS DEL MANIFIESTO FIRMADO')).toBeInTheDocument();
    expect(
      screen.getByText('Fotografía el papel firmado por el local. Es el respaldo si después falta un paquete.')
    ).toBeInTheDocument();
  });

  it('renders a count of 0 and only the Agregar tile when there are no photos', () => {
    mockUseManifestDocuments.mockReturnValue({ data: [], isLoading: false, isFetching: false });
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
      isLoading: false,
      isFetching: false,
    });
    render(<ManifestPhotoStrip operatorId="op-1" manifestId="manifest-1" userId="user-1" />);
    expect(screen.getByTestId('manifest-photo-count')).toHaveTextContent('2');
    expect(screen.getByText('hoja 1')).toBeInTheDocument();
    expect(screen.getByText('hoja 2')).toBeInTheDocument();
    expect(screen.getByText('Agregar')).toBeInTheDocument();
  });

  it('uploads the picked file as MAX(sheet_number)+1, not length+1', async () => {
    // Seguimiento, ronda 2 de review del PR #706 — length+1 y MAX+1 coinciden
    // aquí sólo porque no hay huecos; el fixture no distingue los dos. Esta
    // aserción por sí sola no prueba MAX(sheet_number), sólo confirma que la
    // subida sigue funcionando con datos contiguos.
    mockUseManifestDocuments.mockReturnValue({
      data: [
        { id: 'doc-1', storage_path: 'op-1/manifest-1/sheet-1.jpg', sheet_number: 1, captured_at: '2026-09-08T09:00:00Z' },
      ],
      isLoading: false,
      isFetching: false,
    });
    render(<ManifestPhotoStrip operatorId="op-1" manifestId="manifest-1" userId="user-1" />);

    const input = screen.getByTestId('manifest-photo-input') as HTMLInputElement;
    const file = makeFile();
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledOnce());
    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        operatorId: 'op-1',
        manifestId: 'manifest-1',
        userId: 'user-1',
        sheetNumber: 2,
        file,
      })
    );
  });

  // Seguimiento, ronda 2 — con un hueco (hoja 1 borrada, sólo queda hoja 2
  // viva), length+1 daría 2 (colisión); MAX(sheet_number)+1 da 3.
  it('uses MAX(sheet_number)+1 so a gap from a deleted sheet is never reused', async () => {
    mockUseManifestDocuments.mockReturnValue({
      data: [
        { id: 'doc-2', storage_path: 'op-1/manifest-1/sheet-2.jpg', sheet_number: 2, captured_at: '2026-09-08T09:01:00Z' },
      ],
      isLoading: false,
      isFetching: false,
    });
    render(<ManifestPhotoStrip operatorId="op-1" manifestId="manifest-1" userId="user-1" />);

    const input = screen.getByTestId('manifest-photo-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledOnce());
    expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ sheetNumber: 3 }));
  });

  it('does not render an Agregar tile the operator can act on when manifestId is missing', () => {
    mockUseManifestDocuments.mockReturnValue({ data: [], isLoading: false, isFetching: false });
    render(<ManifestPhotoStrip operatorId="op-1" manifestId={null} userId="user-1" />);
    expect(screen.getByTestId('manifest-photo-input')).toBeDisabled();
    expect(screen.getByRole('button', { name: /agregar/i })).toBeDisabled();
  });

  // Bloqueante 2, ronda 2 de review del PR #706 — doble toque en "Agregar":
  // `isPending` vuelve a `false` en cuanto la mutación resuelve, un
  // round-trip ANTES de que el refetch de la lista actualice `documents`.
  // Sin gatear también por `isFetching`, un segundo toque en esa ventana
  // recalcula el MISMO sheetNumber, el upload tiene éxito, y el insert
  // revienta con 23505 — huérfano en el bucket.
  it('disables Agregar while the document list is refetching, even though the upload mutation itself is not pending', () => {
    mockUseManifestDocuments.mockReturnValue({ data: [], isLoading: false, isFetching: true });
    render(<ManifestPhotoStrip operatorId="op-1" manifestId="manifest-1" userId="user-1" />);
    expect(screen.getByRole('button', { name: /agregar/i })).toBeDisabled();
  });

  // Bloqueante 1, ronda 2 de review del PR #706 — F3 (ronda 2 de #679) ya
  // fijó la regla para esta misma pantalla: nunca pintar texto crudo de
  // Postgres/red en una PWA en español. El toast anterior mostraba
  // `err.message` sin traducir.
  it('shows a fixed Spanish error and does not leak the raw error message when the upload fails', async () => {
    mockUseManifestDocuments.mockReturnValue({ data: [], isLoading: false, isFetching: false });
    mockMutateAsync.mockRejectedValueOnce(new Error('TypeError: Failed to fetch'));
    render(<ManifestPhotoStrip operatorId="op-1" manifestId="manifest-1" userId="user-1" />);

    const input = screen.getByTestId('manifest-photo-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });

    await waitFor(() => expect(mockToastError).toHaveBeenCalledOnce());
    const [message] = mockToastError.mock.calls[0];
    expect(message).toBe('Esta foto no se guardó. Reintenta con señal.');
    expect(message).not.toContain('Failed to fetch');
  });
});
