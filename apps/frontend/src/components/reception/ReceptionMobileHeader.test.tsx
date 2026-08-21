import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReceptionMobileHeader } from './ReceptionMobileHeader';

describe('ReceptionMobileHeader', () => {
  it('muestra el título, el nombre del receptor y sus iniciales', () => {
    render(<ReceptionMobileHeader userName="Paulina Valdés" />);
    expect(screen.getByRole('heading', { name: 'Recepción' })).toBeInTheDocument();
    expect(screen.getByText(/Paulina Valdés/)).toBeInTheDocument();
    expect(screen.getByTestId('reception-mobile-avatar')).toHaveTextContent('PV');
  });

  it('sin nombre no inventa turno ni andén', () => {
    // El mock dice "Recepción · Andén 2 · turno AM": ninguno de los dos existe
    // en el schema (ver la tabla de renuncias del spec). No se rellenan.
    render(<ReceptionMobileHeader userName={null} />);
    expect(screen.queryByText(/turno/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/andén/i)).not.toBeInTheDocument();
  });

  it('sin nombre no deja separador huérfano ni "undefined" en el subtítulo', () => {
    render(<ReceptionMobileHeader userName={null} />);
    expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument();
    const subtitle = screen.getByTestId('reception-mobile-subtitle');
    expect(subtitle.textContent).toBe('');
  });
});
