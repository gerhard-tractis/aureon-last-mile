import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Mock ScrollReveal to passthrough
vi.mock('../scroll-reveal', () => ({
  ScrollReveal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { ValueProps } from '../value-props';

describe('ValueProps', () => {
  it('renders section heading', () => {
    render(<ValueProps />);
    expect(screen.getByText('Beneficios')).toBeInTheDocument();
  });

  it('renders 3 value proposition cards', () => {
    render(<ValueProps />);
    expect(screen.getByText('Operaciones más rápidas')).toBeInTheDocument();
    expect(screen.getByText('Menos entregas fallidas')).toBeInTheDocument();
    expect(screen.getByText('Decisiones con datos')).toBeInTheDocument();
  });
});
