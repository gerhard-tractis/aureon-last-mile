import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PhotoReviewSheet } from './PhotoReviewSheet';

const makePhoto = () => new File(['data'], 'sheet-3.jpg', { type: 'image/jpeg' });

describe('PhotoReviewSheet', () => {
  const createObjectURL = vi.fn(() => 'blob:preview-url');
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the mock heading with the sheet number and load label', () => {
    render(
      <PhotoReviewSheet
        loadLabel="CARGA-99814"
        sheetNumber={3}
        photo={makePhoto()}
        onRetake={vi.fn()}
        onUsePhoto={vi.fn()}
      />
    );
    expect(screen.getByText('Revisar hoja 3')).toBeInTheDocument();
    expect(screen.getByText('CARGA-99814')).toBeInTheDocument();
  });

  it('shows the literal legibility warning from the mock', () => {
    render(
      <PhotoReviewSheet
        loadLabel="CARGA-99814"
        sheetNumber={3}
        photo={makePhoto()}
        onRetake={vi.fn()}
        onUsePhoto={vi.fn()}
      />
    );
    expect(
      screen.getByText('¿Se lee la firma? Una foto borrosa no sirve como respaldo.')
    ).toBeInTheDocument();
  });

  it('renders the captured photo as an object URL preview', () => {
    const photo = makePhoto();
    render(
      <PhotoReviewSheet
        loadLabel="CARGA-99814"
        sheetNumber={3}
        photo={photo}
        onRetake={vi.fn()}
        onUsePhoto={vi.fn()}
      />
    );
    expect(createObjectURL).toHaveBeenCalledWith(photo);
    expect(screen.getByTestId('photo-review-preview')).toHaveAttribute('src', 'blob:preview-url');
  });

  it('revokes the preview object URL on unmount so it does not leak', () => {
    const { unmount } = render(
      <PhotoReviewSheet
        loadLabel="CARGA-99814"
        sheetNumber={3}
        photo={makePhoto()}
        onRetake={vi.fn()}
        onUsePhoto={vi.fn()}
      />
    );
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview-url');
  });

  it('calls onRetake when "Repetir" is pressed', () => {
    const onRetake = vi.fn();
    render(
      <PhotoReviewSheet
        loadLabel="CARGA-99814"
        sheetNumber={3}
        photo={makePhoto()}
        onRetake={onRetake}
        onUsePhoto={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Repetir' }));
    expect(onRetake).toHaveBeenCalledOnce();
  });

  it('calls onUsePhoto with the photo when "Usar foto" is pressed', () => {
    const onUsePhoto = vi.fn();
    const photo = makePhoto();
    render(
      <PhotoReviewSheet
        loadLabel="CARGA-99814"
        sheetNumber={3}
        photo={photo}
        onRetake={vi.fn()}
        onUsePhoto={onUsePhoto}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Usar foto' }));
    expect(onUsePhoto).toHaveBeenCalledWith(photo);
  });

  it('disables both actions while a save is in flight', () => {
    render(
      <PhotoReviewSheet
        loadLabel="CARGA-99814"
        sheetNumber={3}
        photo={makePhoto()}
        onRetake={vi.fn()}
        onUsePhoto={vi.fn()}
        isSaving
      />
    );
    expect(screen.getByRole('button', { name: 'Repetir' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /usar foto/i })).toBeDisabled();
  });

  // M4, ronda 3 de review del PR #713 — "role=dialog en ... 5h ...
  // sobreviven, lo que entregaste como M4 no tiene un solo test."
  it('exposes itself as a dialog with an aria-modal label', () => {
    render(
      <PhotoReviewSheet
        loadLabel="CARGA-99814"
        sheetNumber={3}
        photo={makePhoto()}
        onRetake={vi.fn()}
        onUsePhoto={vi.fn()}
      />
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Revisar hoja 3');
  });

  // Ronda 3 — `useEffect(..., [photo]) → []` seguía vivo desde la ronda 1:
  // sin este test, nada distingue "vuelve a crear la preview en cada
  // renderizado" de "sólo la crea cuando `photo` de verdad cambia" (y sin
  // el segundo, repetir una foto en 5g dejaría la vista atascada mirando la
  // primera).
  it('regenerates the preview URL (and revokes the old one) when the photo prop changes', () => {
    const firstPhoto = makePhoto();
    const secondPhoto = new File(['other'], 'sheet-3-retake.jpg', { type: 'image/jpeg' });
    createObjectURL.mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second');

    const { rerender } = render(
      <PhotoReviewSheet
        loadLabel="CARGA-99814"
        sheetNumber={3}
        photo={firstPhoto}
        onRetake={vi.fn()}
        onUsePhoto={vi.fn()}
      />
    );
    expect(screen.getByTestId('photo-review-preview')).toHaveAttribute('src', 'blob:first');

    rerender(
      <PhotoReviewSheet
        loadLabel="CARGA-99814"
        sheetNumber={3}
        photo={secondPhoto}
        onRetake={vi.fn()}
        onUsePhoto={vi.fn()}
      />
    );

    expect(createObjectURL).toHaveBeenCalledWith(secondPhoto);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:first');
    expect(screen.getByTestId('photo-review-preview')).toHaveAttribute('src', 'blob:second');
  });
});
