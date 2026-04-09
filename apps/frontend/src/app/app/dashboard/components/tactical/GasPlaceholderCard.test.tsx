import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GasPlaceholderCard } from './GasPlaceholderCard';

describe('GasPlaceholderCard', () => {
  it('renders gas/combustible label', () => {
    render(<GasPlaceholderCard />);
    expect(screen.getAllByText(/[Cc]ombustible/).length).toBeGreaterThanOrEqual(1);
  });

  it('renders — as the value', () => {
    render(<GasPlaceholderCard />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders Próximamente badge', () => {
    render(<GasPlaceholderCard />);
    expect(screen.getByText('Próximamente')).toBeInTheDocument();
  });

  it('renders tooltip text "Requiere odómetro"', () => {
    render(<GasPlaceholderCard />);
    expect(screen.getByText(/[Rr]equiere odómetro/)).toBeInTheDocument();
  });
});
