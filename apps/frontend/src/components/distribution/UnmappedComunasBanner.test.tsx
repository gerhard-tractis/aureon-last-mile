// apps/frontend/src/components/distribution/UnmappedComunasBanner.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UnmappedComunasBanner } from './UnmappedComunasBanner';

describe('UnmappedComunasBanner', () => {
  it('renders nothing when no unmapped comunas', () => {
    const { container } = render(<UnmappedComunasBanner unmappedComunas={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows banner with unmapped comunas list', () => {
    render(<UnmappedComunasBanner unmappedComunas={['Peñalolén', 'La Florida']} />);
    expect(screen.getByText(/comunas sin andén/i)).toBeInTheDocument();
    expect(screen.getByText('Peñalolén')).toBeInTheDocument();
    expect(screen.getByText('La Florida')).toBeInTheDocument();
  });
});
