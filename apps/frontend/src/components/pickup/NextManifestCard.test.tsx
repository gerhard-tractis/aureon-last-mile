import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextManifestCard } from './NextManifestCard';
import type { RouteManifestRow } from './RouteManifestList';

const MANIFEST: RouteManifestRow = {
  id: 'm1',
  external_load_id: 'LOAD-19',
  retailer_name: 'Falabella',
  pickup_location: 'Av. Providencia 1234, Providencia',
  total_orders: 5,
  total_packages: 8,
  verified_count: 3,
};

describe('NextManifestCard', () => {
  it('renders the retailer, load id, package/order counts and progress', () => {
    render(<NextManifestCard manifest={MANIFEST} index={0} onVerify={vi.fn()} />);
    expect(screen.getByText('Falabella')).toBeInTheDocument();
    expect(screen.getByText(/LOAD-19/)).toBeInTheDocument();
    expect(screen.getByText(/5 órdenes/)).toBeInTheDocument();
    expect(screen.getByText(/8 paquetes/)).toBeInTheDocument();
    expect(screen.getByText('3/8')).toBeInTheDocument();
  });

  it('shows the 1-based position in the index box', () => {
    render(<NextManifestCard manifest={MANIFEST} index={2} onVerify={vi.fn()} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('calls onVerify with the external load id when the primary action is pressed', () => {
    const onVerify = vi.fn();
    render(<NextManifestCard manifest={MANIFEST} index={0} onVerify={onVerify} />);
    fireEvent.click(screen.getByRole('button', { name: /verificar/i }));
    expect(onVerify).toHaveBeenCalledWith('LOAD-19');
  });

  it('has a primary action at least 44px tall for touch', () => {
    render(<NextManifestCard manifest={MANIFEST} index={0} onVerify={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /verificar/i });
    // Tailwind class carries the intended height — asserted via class rather
    // than computed layout, which jsdom does not lay out.
    expect(btn.className).toMatch(/min-h-\[(4[4-9]|5[0-9]|6[0-9])px\]/);
  });

  it('does not render a call button or ETA — no phone number is one query away and no per-stop ETA exists for a pickup manifest', () => {
    render(<NextManifestCard manifest={MANIFEST} index={0} onVerify={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /llamar/i })).toBeNull();
    expect(screen.queryByText(/eta/i)).toBeNull();
  });

  it('shows the pickup address when present', () => {
    render(<NextManifestCard manifest={MANIFEST} index={0} onVerify={vi.fn()} />);
    expect(screen.getByText('Av. Providencia 1234, Providencia')).toBeInTheDocument();
  });

  it('omits the address line rather than fabricating one when pickup_location is null', () => {
    render(
      <NextManifestCard
        manifest={{ ...MANIFEST, pickup_location: null }}
        index={0}
        onVerify={vi.fn()}
      />,
    );
    expect(screen.queryByText('Av. Providencia 1234, Providencia')).toBeNull();
  });

  it('shows an unknown package total as "—" instead of reading null as zero', () => {
    render(
      <NextManifestCard
        manifest={{ ...MANIFEST, total_packages: null, verified_count: 5 }}
        index={0}
        onVerify={vi.fn()}
      />,
    );
    expect(screen.getByText('5/—')).toBeInTheDocument();
    expect(screen.getByText(/— paquetes/)).toBeInTheDocument();
  });
});
