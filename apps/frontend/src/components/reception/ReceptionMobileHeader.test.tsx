import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReceptionMobileHeader } from './ReceptionMobileHeader';

describe('ReceptionMobileHeader', () => {
  it('shows the title, the receptionist name and their initials', () => {
    render(<ReceptionMobileHeader userName="Paulina Valdés" />);
    expect(screen.getByRole('heading', { name: 'Recepción' })).toBeInTheDocument();
    expect(screen.getByText(/Paulina Valdés/)).toBeInTheDocument();
    expect(screen.getByTestId('reception-mobile-avatar')).toHaveTextContent(/^PV$/);
  });

  it('without a name, does not fabricate a shift or a dock', () => {
    // The mock reads "Recepción · Andén 2 · turno AM": neither concept exists
    // in the schema (see the renunciations table in the spec). Not filled in.
    render(<ReceptionMobileHeader userName={null} />);
    expect(screen.queryByText(/turno/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/andén/i)).not.toBeInTheDocument();
  });

  it('without a name, leaves no orphan separator or "undefined" in the subtitle', () => {
    render(<ReceptionMobileHeader userName={null} />);
    expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument();
    const subtitle = screen.getByTestId('reception-mobile-subtitle');
    expect(subtitle.textContent).toBe('');
  });
});
