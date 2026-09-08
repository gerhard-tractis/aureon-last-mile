import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MissingPackageRow } from './MissingPackageRow';

describe('MissingPackageRow', () => {
  it('renders the package label and order number', () => {
    render(
      <MissingPackageRow
        packageId="p1"
        packageLabel="CL7742891005"
        orderNumber="ORD-48213"
        existingNote=""
        onSaveNote={vi.fn()}
      />
    );
    expect(screen.getByText('CL7742891005')).toBeInTheDocument();
    expect(screen.getByText(/ORD-48213/)).toBeInTheDocument();
  });

  it('renders the customer name alongside the order number when provided', () => {
    render(
      <MissingPackageRow
        packageId="p1"
        packageLabel="CL7742891005"
        orderNumber="ORD-48213"
        customerName="Camila Fernández"
        existingNote=""
        onSaveNote={vi.fn()}
      />
    );
    expect(screen.getByText('ORD-48213 · Camila Fernández')).toBeInTheDocument();
  });

  it('shows a "Nota" button and no CON NOTA badge when there is no existing note', () => {
    render(
      <MissingPackageRow
        packageId="p1"
        packageLabel="CL7742891005"
        orderNumber="ORD-48213"
        existingNote=""
        onSaveNote={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /^nota$/i })).toBeInTheDocument();
    expect(screen.queryByText(/con nota/i)).not.toBeInTheDocument();
  });

  it('clicking "Nota" reveals an inline field to write the note', () => {
    render(
      <MissingPackageRow
        packageId="p1"
        packageLabel="CL7742891005"
        orderNumber="ORD-48213"
        existingNote=""
        onSaveNote={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^nota$/i }));
    expect(
      screen.getByPlaceholderText(/motivo del faltante/i)
    ).toBeInTheDocument();
  });

  it('saving the note calls onSaveNote with the trimmed text', async () => {
    const onSaveNote = vi.fn().mockResolvedValue(undefined);
    render(
      <MissingPackageRow
        packageId="p1"
        packageLabel="CL7742891005"
        orderNumber="ORD-48213"
        existingNote=""
        onSaveNote={onSaveNote}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^nota$/i }));
    fireEvent.change(screen.getByPlaceholderText(/motivo del faltante/i), {
      target: { value: '  El local no lo encontró en bodega.  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));
    expect(onSaveNote).toHaveBeenCalledWith(
      'p1',
      'El local no lo encontró en bodega.'
    );
    await waitFor(() => {
      expect(
        screen.queryByPlaceholderText(/motivo del faltante/i)
      ).not.toBeInTheDocument();
    });
  });

  it('does not call onSaveNote when the field is only whitespace', () => {
    const onSaveNote = vi.fn();
    render(
      <MissingPackageRow
        packageId="p1"
        packageLabel="CL7742891005"
        orderNumber="ORD-48213"
        existingNote=""
        onSaveNote={onSaveNote}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^nota$/i }));
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));
    expect(onSaveNote).not.toHaveBeenCalled();
  });

  // Medio 4 (review PR #686): handleSave cleared the draft and closed the
  // editor unconditionally, right after the exact case (no network) where
  // useSaveDiscrepancyNote's .insert() has no offline queue behind it and
  // silently fails. The typed note vanished from everywhere. It must not be
  // discarded until the save actually succeeds.
  it('keeps the draft text and the editor open, and shows an error, when onSaveNote fails', async () => {
    const onSaveNote = vi.fn().mockRejectedValue(new Error('network down'));
    render(
      <MissingPackageRow
        packageId="p1"
        packageLabel="CL7742891005"
        orderNumber="ORD-48213"
        existingNote=""
        onSaveNote={onSaveNote}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^nota$/i }));
    fireEvent.change(screen.getByPlaceholderText(/motivo del faltante/i), {
      target: { value: 'El local no lo encontró en bodega.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));

    expect(await screen.findByText(/no se pudo guardar/i)).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/motivo del faltante/i)
    ).toHaveValue('El local no lo encontró en bodega.');
    expect(screen.queryByText(/con nota/i)).not.toBeInTheDocument();
  });

  it('clears the draft and closes the editor once onSaveNote resolves', async () => {
    const onSaveNote = vi.fn().mockResolvedValue(undefined);
    render(
      <MissingPackageRow
        packageId="p1"
        packageLabel="CL7742891005"
        orderNumber="ORD-48213"
        existingNote=""
        onSaveNote={onSaveNote}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^nota$/i }));
    fireEvent.change(screen.getByPlaceholderText(/motivo del faltante/i), {
      target: { value: 'El local no lo encontró en bodega.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));

    await waitFor(() => {
      expect(
        screen.queryByPlaceholderText(/motivo del faltante/i)
      ).not.toBeInTheDocument();
    });
  });

  it('shows the CON NOTA badge and the quoted note, no Nota button, once a note exists', () => {
    render(
      <MissingPackageRow
        packageId="p1"
        packageLabel="CL7742891061"
        orderNumber="ORD-48231"
        existingNote="El local no lo encontró en bodega, queda para mañana."
        onSaveNote={vi.fn()}
      />
    );
    expect(screen.getByText(/con nota/i)).toBeInTheDocument();
    expect(
      screen.getByText('"El local no lo encontró en bodega, queda para mañana."')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^nota$/i })).not.toBeInTheDocument();
  });
});
