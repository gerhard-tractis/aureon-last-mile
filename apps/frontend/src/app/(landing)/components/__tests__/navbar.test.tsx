import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children: React.ReactNode }) => <div data-testid="sheet-content">{children}</div>,
}));

import { Navbar } from '../navbar';

describe('Navbar', () => {
  it('renders the Aureon brand', () => {
    render(<Navbar isAuthenticated={false} />);
    expect(screen.getByText('Aureon')).toBeInTheDocument();
  });

  it('shows "Ingresa" when not authenticated', () => {
    render(<Navbar isAuthenticated={false} />);
    const links = screen.getAllByRole('link', { name: /ingresa/i });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveAttribute('href', '/auth/login');
  });

  it('shows "Ir al Panel" when authenticated', () => {
    render(<Navbar isAuthenticated={true} />);
    const links = screen.getAllByRole('link', { name: /ir al panel/i });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveAttribute('href', '/app');
  });

  it('renders demo CTA linking to Google Calendar', () => {
    render(<Navbar isAuthenticated={false} />);
    const demoLinks = screen.getAllByRole('link', { name: /agenda una llamada/i });
    expect(demoLinks.length).toBeGreaterThan(0);
    expect(demoLinks[0]).toHaveAttribute('href', 'https://calendar.app.google/k9siT3q8FuxjGf9v5');
    expect(demoLinks[0]).toHaveAttribute('target', '_blank');
  });

  it('renders anchor navigation links', () => {
    render(<Navbar isAuthenticated={false} />);
    expect(screen.getAllByText('El problema').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Inteligencia').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Agentes').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Operación').length).toBeGreaterThan(0);
  });
});
