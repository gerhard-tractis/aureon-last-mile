import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ManifestPhotoStrip } from './ManifestPhotoStrip';

const mockUseManifestDocuments = vi.fn();
const mockMutateAsync = vi.fn();

vi.mock('@/hooks/pickup/useManifestDocuments', () => ({
  useManifestDocuments: (...args: unknown[]) => mockUseManifestDocuments(...args),
  useUploadManifestDocument: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
}));

const makeFile = (name = 'sheet.jpg') => new File(['data'], name, { type: 'image/jpeg' });

describe('ManifestPhotoStrip', () => {
  beforeEach(() => {
    mockUseManifestDocuments.mockReset();
    mockMutateAsync.mockReset();
    mockMutateAsync.mockResolvedValue(undefined);
  });

  it('shows the mock heading and subtitle', () => {
    mockUseManifestDocuments.mockReturnValue({ data: [], isLoading: false });
    render(
      <ManifestPhotoStrip operatorId="op-1" manifestId="manifest-1" userId="user-1" />
    );
    expect(screen.getByText('FOTOS DEL MANIFIESTO FIRMADO')).toBeInTheDocument();
    expect(
      screen.getByText('Fotografía el papel firmado por el local. Es el respaldo si después falta un paquete.')
    ).toBeInTheDocument();
  });

  it('renders a count of 0 and only the Agregar tile when there are no photos', () => {
    mockUseManifestDocuments.mockReturnValue({ data: [], isLoading: false });
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
    });
    render(<ManifestPhotoStrip operatorId="op-1" manifestId="manifest-1" userId="user-1" />);
    expect(screen.getByTestId('manifest-photo-count')).toHaveTextContent('2');
    expect(screen.getByText('hoja 1')).toBeInTheDocument();
    expect(screen.getByText('hoja 2')).toBeInTheDocument();
    expect(screen.getByText('Agregar')).toBeInTheDocument();
  });

  it('uploads the picked file as the next sheet number when Agregar is used', async () => {
    mockUseManifestDocuments.mockReturnValue({
      data: [
        { id: 'doc-1', storage_path: 'op-1/manifest-1/sheet-1.jpg', sheet_number: 1, captured_at: '2026-09-08T09:00:00Z' },
      ],
      isLoading: false,
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

  it('does not render anything to click when manifestId is missing', () => {
    mockUseManifestDocuments.mockReturnValue({ data: [], isLoading: false });
    render(<ManifestPhotoStrip operatorId="op-1" manifestId={null} userId="user-1" />);
    expect(screen.getByTestId('manifest-photo-input')).toBeDisabled();
  });
});
