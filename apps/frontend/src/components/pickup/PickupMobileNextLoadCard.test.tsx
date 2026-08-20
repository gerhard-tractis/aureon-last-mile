import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PickupMobileNextLoadCard } from './PickupMobileNextLoadCard';
import type { RouteManifestRow } from './RouteManifestList';

/** Matches an element's full textContent, tolerating the number and unit
 *  sitting in separate nested elements (font-mono numeric per rule 4). */
function byFullText(text: string) {
  return (_content: string, node: Element | null) => node?.textContent === text;
}

function manifest(overrides: Partial<RouteManifestRow> = {}): RouteManifestRow {
  return {
    id: 'm1',
    external_load_id: 'CARGA-99814',
    retailer_name: 'Falabella',
    pickup_location: 'Mall Plaza Vespucio',
    total_orders: 18,
    total_packages: 42,
    verified_count: 0,
    status: 'pending',
    ...overrides,
  };
}

describe('PickupMobileNextLoadCard', () => {
  it('leads with the pickup place as the headline, not the load code', () => {
    render(<PickupMobileNextLoadCard manifest={manifest()} onStart={vi.fn()} />);
    expect(
      screen.getByRole('heading', { name: 'Mall Plaza Vespucio' }),
    ).toBeInTheDocument();
  });

  it('shows the retailer as a secondary line', () => {
    render(<PickupMobileNextLoadCard manifest={manifest()} onStart={vi.fn()} />);
    expect(screen.getByText('Falabella')).toBeInTheDocument();
  });

  it('shows the SIGUIENTE pill, never a position number', () => {
    render(<PickupMobileNextLoadCard manifest={manifest()} onStart={vi.fn()} />);
    expect(screen.getByText('SIGUIENTE')).toBeInTheDocument();
    expect(screen.queryByText(/^#?1$/)).not.toBeInTheDocument();
  });

  it('shows chips for the load code, package count and order count', () => {
    render(<PickupMobileNextLoadCard manifest={manifest()} onStart={vi.fn()} />);
    expect(screen.getByText('CARGA-99814')).toBeInTheDocument();
    expect(screen.getByText(byFullText('42 paquetes'))).toBeInTheDocument();
    expect(screen.getByText(byFullText('18 órdenes'))).toBeInTheDocument();
  });

  it('renders an unknown package total as — rather than 0', () => {
    render(
      <PickupMobileNextLoadCard
        manifest={manifest({ total_packages: null })}
        onStart={vi.fn()}
      />,
    );
    expect(screen.getByText(byFullText('— paquetes'))).toBeInTheDocument();
  });

  it('calls onStart when "Iniciar recogida" is pressed', async () => {
    const onStart = vi.fn();
    render(<PickupMobileNextLoadCard manifest={manifest()} onStart={onStart} />);
    await userEvent.click(screen.getByRole('button', { name: /iniciar recogida/i }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('falls back to the load code as the headline when pickup_location is unknown', () => {
    render(
      <PickupMobileNextLoadCard
        manifest={manifest({ pickup_location: null })}
        onStart={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'CARGA-99814' })).toBeInTheDocument();
  });

  // White on --color-accent is ~2.6:1, below the 4.5:1 floor — the repo's
  // own fix for this is --color-accent-light-foreground on --color-accent-light.
  it('uses the AA-contrast accent-light tokens on the primary button and pill, never bare accent', () => {
    render(<PickupMobileNextLoadCard manifest={manifest()} onStart={vi.fn()} />);
    // Split into class tokens rather than substring/regex matching — both
    // `bg-accent-light` and the disallowed `bg-accent` share the substring
    // "bg-accent", so a naive check would false-negative against the fix.
    const button = screen.getByRole('button', { name: /iniciar recogida/i });
    const buttonClasses = button.className.split(/\s+/);
    expect(buttonClasses).toContain('bg-accent-light');
    expect(buttonClasses).toContain('text-accent-light-foreground');
    expect(buttonClasses).not.toContain('bg-accent');
    expect(buttonClasses).not.toContain('text-accent-foreground');

    const pill = screen.getByText('SIGUIENTE');
    const pillClasses = pill.className.split(/\s+/);
    expect(pillClasses).toContain('bg-accent-light');
    expect(pillClasses).toContain('text-accent-light-foreground');
    expect(pillClasses).not.toContain('bg-accent');
    expect(pillClasses).not.toContain('text-accent-foreground');
  });
});
