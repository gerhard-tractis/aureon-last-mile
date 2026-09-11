import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClientSignatureSection } from './ClientSignatureSection';

vi.mock('@/components/pickup/SignaturePad', () => ({
  SignaturePad: ({ label, onChange }: { label: string; onChange: (sig: string) => void }) => (
    <button type="button" data-testid={`signature-pad-${label}`} onClick={() => onChange('sig')}>
      {label}
    </button>
  ),
}));

describe('ClientSignatureSection', () => {
  it('renders the FIRMA DEL LOCAL heading', () => {
    render(
      <ClientSignatureSection
        showClientSig={false}
        onToggleShowClientSig={vi.fn()}
        clientName=""
        onClientNameChange={vi.fn()}
        onClientSignatureChange={vi.fn()}
      />,
    );
    expect(screen.getByText('FIRMA DEL LOCAL')).toBeInTheDocument();
  });

  it('hides the signature pad until the checkbox is checked', () => {
    render(
      <ClientSignatureSection
        showClientSig={false}
        onToggleShowClientSig={vi.fn()}
        clientName=""
        onClientNameChange={vi.fn()}
        onClientSignatureChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('signature-pad-Firma del cliente (opcional)')).not.toBeInTheDocument();
  });

  it('shows the signature pad and name input once checked', () => {
    render(
      <ClientSignatureSection
        showClientSig={true}
        onToggleShowClientSig={vi.fn()}
        clientName=""
        onClientNameChange={vi.fn()}
        onClientSignatureChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('signature-pad-Firma del cliente (opcional)')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Nombre del cliente')).toBeInTheDocument();
  });

  // spec-95 fase 6, mock `5f` — "opcional" a la derecha de la fila de la
  // casilla, mismo texto que ya lleva el label del SignaturePad.
  //
  // m4, ronda 2 de review — `getByText('opcional')` sólo comprobaba que el
  // texto existiera EN ALGÚN SITIO: quitar `ml-auto` (lo que lo empuja a la
  // derecha) pasaba igual. Se ancla la clase que produce "a la derecha".
  it('renders "opcional" to the right of the checkbox row', () => {
    render(
      <ClientSignatureSection
        showClientSig={false}
        onToggleShowClientSig={vi.fn()}
        clientName=""
        onClientNameChange={vi.fn()}
        onClientSignatureChange={vi.fn()}
      />,
    );
    const opcional = screen.getByText('opcional');
    expect(opcional).toBeInTheDocument();
    expect(opcional.className).toContain('ml-auto');
  });

  // m3, ronda 2 de review — "opcional" no está dentro del <label> (no
  // rompe `getByLabelText` en `page.test.tsx`), pero por eso mismo un
  // lector de pantalla nunca lo anunciaba tabulando a la casilla.
  // `aria-describedby` cierra el hueco sin volver a romper el matcher.
  it('links the checkbox to "opcional" via aria-describedby, so a screen reader announces it too', () => {
    render(
      <ClientSignatureSection
        showClientSig={false}
        onToggleShowClientSig={vi.fn()}
        clientName=""
        onClientNameChange={vi.fn()}
        onClientSignatureChange={vi.fn()}
      />,
    );
    const checkbox = screen.getByRole('checkbox');
    const describedById = checkbox.getAttribute('aria-describedby');
    expect(describedById).toBeTruthy();
    expect(document.getElementById(describedById as string)).toHaveTextContent('opcional');
  });

  it('fires onToggleShowClientSig when the checkbox is toggled', () => {
    const onToggle = vi.fn();
    render(
      <ClientSignatureSection
        showClientSig={false}
        onToggleShowClientSig={onToggle}
        clientName=""
        onClientNameChange={vi.fn()}
        onClientSignatureChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggle).toHaveBeenCalledWith(true);
  });
});
