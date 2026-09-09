import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OperatorSignatureSection } from './OperatorSignatureSection';

vi.mock('@/components/pickup/SignaturePad', () => ({
  SignaturePad: ({ label, onChange }: { label: string; onChange: (sig: string) => void }) => (
    <button type="button" data-testid={`signature-pad-${label}`} onClick={() => onChange('sig')}>
      {label}
    </button>
  ),
}));

describe('OperatorSignatureSection', () => {
  it('renders the TU FIRMA heading and operator name', () => {
    render(<OperatorSignatureSection operatorName="Test User" onOperatorSignatureChange={vi.fn()} />);
    expect(screen.getByText('TU FIRMA')).toBeInTheDocument();
    expect(screen.getByText('Test User')).toBeInTheDocument();
  });

  it('renders the required SignaturePad', () => {
    render(<OperatorSignatureSection operatorName="Test User" onOperatorSignatureChange={vi.fn()} />);
    expect(screen.getByTestId('signature-pad-Firma del operador (obligatoria)')).toBeInTheDocument();
  });

  it('fires onOperatorSignatureChange when signed', () => {
    const onChange = vi.fn();
    render(<OperatorSignatureSection operatorName="Test User" onOperatorSignatureChange={onChange} />);
    fireEvent.click(screen.getByTestId('signature-pad-Firma del operador (obligatoria)'));
    expect(onChange).toHaveBeenCalledWith('sig');
  });
});
