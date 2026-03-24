import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { Hero } from '../hero';

describe('Hero', () => {
  it('renders the tagline', () => {
    render(<Hero isAuthenticated={false} />);
    expect(screen.getByText('Tu última milla, bajo control')).toBeInTheDocument();
  });

  it('renders the subtitle', () => {
    render(<Hero isAuthenticated={false} />);
    expect(screen.getByText(/Plataforma inteligente/)).toBeInTheDocument();
  });

  it('renders demo CTA with Google Calendar link', () => {
    render(<Hero isAuthenticated={false} />);
    const link = screen.getByRole('link', { name: /solicita una demo/i });
    expect(link).toHaveAttribute('href', 'https://calendar.app.google/k9siT3q8FuxjGf9v5');
  });

  it('shows "Ingresa" for unauthenticated users', () => {
    render(<Hero isAuthenticated={false} />);
    expect(screen.getByRole('link', { name: /ingresa/i })).toHaveAttribute('href', '/auth/login');
  });

  it('shows "Ir al Panel" for authenticated users', () => {
    render(<Hero isAuthenticated={true} />);
    expect(screen.getByRole('link', { name: /ir al panel/i })).toHaveAttribute('href', '/app');
  });
});
