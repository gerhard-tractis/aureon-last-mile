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

  it('never renders a breadcrumb — the topbar owns it (spec-54)', () => {
    // Rendering one here too showed the same crumb twice on every page the
    // sidebar covers.
    const { container } = render(
      <PageShell title="Operaciones"><div>content</div></PageShell>
    );
    expect(container.querySelector('nav')).toBeNull();
  });

  it('renders actions slot', () => {
    render(
      <PageShell title="Test" actions={<button>Export</button>}>
        <div>content</div>
      </PageShell>
    );
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });

  it('renders without actions', () => {
    const { container } = render(<PageShell title="Simple"><div>ok</div></PageShell>);
    expect(container.querySelector('nav')).toBeNull();
  });
});
