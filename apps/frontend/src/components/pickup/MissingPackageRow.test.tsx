import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

  it('saving the note calls onSaveNote with the trimmed text', () => {
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
    fireEvent.change(screen.getByPlaceholderText(/motivo del faltante/i), {
      target: { value: '  El local no lo encontró en bodega.  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));
    expect(onSaveNote).toHaveBeenCalledWith(
      'p1',
      'El local no lo encontró en bodega.'
    );
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
