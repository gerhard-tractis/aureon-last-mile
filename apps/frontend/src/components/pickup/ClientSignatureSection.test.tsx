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
