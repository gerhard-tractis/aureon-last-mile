import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageShell } from './PageShell';

describe('PageShell', () => {
  it('renders page title', () => {
    render(<PageShell title="Dashboard"><div>content</div></PageShell>);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('renders children', () => {
    render(<PageShell title="Test"><div data-testid="child">hello</div></PageShell>);
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('renders breadcrumbs when provided', () => {
    render(
      <PageShell title="Operaciones" breadcrumbs={[{ label: 'Dashboard', href: '/app/dashboard' }, { label: 'Operaciones' }]}>
        <div>content</div>
      </PageShell>
    );
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getAllByText('Operaciones').length).toBeGreaterThan(0);
  });

  it('renders actions slot', () => {
    render(
      <PageShell title="Test" actions={<button>Export</button>}>
        <div>content</div>
      </PageShell>
    );
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });

  it('renders without breadcrumbs or actions', () => {
    const { container } = render(<PageShell title="Simple"><div>ok</div></PageShell>);
    expect(container.querySelector('nav')).toBeNull(); // no breadcrumb nav
  });
});
