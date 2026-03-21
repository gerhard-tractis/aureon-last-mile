import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState';
import { Package } from 'lucide-react';

describe('EmptyState', () => {
  it('renders title and description', () => {
    render(<EmptyState icon={Package} title="No hay pedidos" description="Aun no hay pedidos registrados" />);
    expect(screen.getByText('No hay pedidos')).toBeInTheDocument();
    expect(screen.getByText('Aun no hay pedidos registrados')).toBeInTheDocument();
  });

  it('renders action button when provided', () => {
    render(
      <EmptyState
        icon={Package}
        title="No hay pedidos"
        description="Aun no hay pedidos"
        action={{ label: 'Crear pedido', onClick: () => {} }}
      />
    );
    expect(screen.getByRole('button', { name: 'Crear pedido' })).toBeInTheDocument();
  });

  it('renders link action when href provided', () => {
    render(
      <EmptyState
        icon={Package}
        title="No hay pedidos"
        description="Aun no hay pedidos"
        action={{ label: 'Ver guia', href: '/docs' }}
      />
    );
    expect(screen.getByRole('link', { name: 'Ver guia' })).toBeInTheDocument();
  });

  it('renders without action', () => {
    const { container } = render(
      <EmptyState icon={Package} title="No data" description="Nothing here" />
    );
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });
});
