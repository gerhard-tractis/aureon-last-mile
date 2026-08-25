import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Layers } from 'lucide-react';
import { DistributionProcessRow } from './DistributionProcessRow';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

describe('DistributionProcessRow', () => {
  it('renders as a real link when href is provided', () => {
    render(
      <DistributionProcessRow
        href="/app/distribution/pendientes"
        icon={Layers}
        title="Pendientes de sectorizar"
        subtitle="Agrupados por andén"
        count={12}
      />,
    );
    const link = screen.getByRole('link', { name: /pendientes de sectorizar/i });
    expect(link).toHaveAttribute('href', '/app/distribution/pendientes');
    expect(link).toHaveTextContent('12');
  });

  // spec-68 review fix (finding 1) — none of `/pendientes`, `/consolidacion`
  // or `/andenes` exist yet (Fases 3/4/6). A `<Link>` to a route that 404s
  // is a live regression, not an unfinished link, and the desktop
  // ConsolidationPanel this replaced isn't rendered below `lg` either — so
  // the row must degrade to something that carries no destination at all.
  it('renders as a non-navigable row when href is null, keeping the label and count', () => {
    render(
      <DistributionProcessRow
        href={null}
        icon={Layers}
        title="Consolidación"
        subtitle="Selección múltiple"
        count={4}
      />,
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Consolidación')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('marks the non-navigable state with aria-disabled and no chevron', () => {
    render(
      <DistributionProcessRow href={null} icon={Layers} title="Andenes" subtitle="Ocupación por zona" />,
    );
    const row = screen.getByTestId('distribution-process-row');
    expect(row).toHaveAttribute('aria-disabled', 'true');
    expect(row.querySelector('svg.lucide-chevron-right')).not.toBeInTheDocument();
  });

  it('still meets the 60px touch floor when non-navigable', () => {
    render(
      <DistributionProcessRow href={null} icon={Layers} title="Andenes" subtitle="Ocupación por zona" />,
    );
    const row = screen.getByTestId('distribution-process-row');
    expect(row.className).toMatch(/min-h-\[?(6\d|[7-9]\d)/);
  });

  it('renders without a count when none is given', () => {
    render(<DistributionProcessRow href={null} icon={Layers} title="Andenes" subtitle="Ocupación" />);
    const row = screen.getByTestId('distribution-process-row');
    // No stray "undefined" text node when `count` is omitted.
    expect(row.textContent).not.toMatch(/undefined/i);
  });
});
