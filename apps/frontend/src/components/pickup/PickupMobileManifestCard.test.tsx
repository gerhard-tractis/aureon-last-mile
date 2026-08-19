import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PickupMobileManifestCard } from './PickupMobileManifestCard';

const baseProps = {
  externalLoadId: 'CARGA-99814',
  retailerName: 'Easy',
  pickupLocation: 'Easy Vespucio',
  totalOrders: 5,
  totalPackages: 12,
  verifiedCount: 0,
  statusLabel: 'Pendiente',
  statusTone: 'pending' as const,
  onOpen: vi.fn(),
};

describe('PickupMobileManifestCard', () => {
  it('renders the load id, retailer, pickup location, orders and packages', () => {
    render(<PickupMobileManifestCard {...baseProps} />);
    expect(screen.getByText('CARGA-99814')).toBeInTheDocument();
    expect(screen.getByText('Easy')).toBeInTheDocument();
    expect(screen.getByText('Easy Vespucio')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('0/12')).toBeInTheDocument();
  });

  it('shows an em dash for an unknown total_packages rather than 0', () => {
    render(<PickupMobileManifestCard {...baseProps} totalPackages={null} verifiedCount={2} />);
    expect(screen.getByText('2/—')).toBeInTheDocument();
  });

  it('renders the status badge with the given label — never a position number', () => {
    render(<PickupMobileManifestCard {...baseProps} statusLabel="En progreso" statusTone="progress" />);
    expect(screen.getByTestId('card-status-badge')).toHaveTextContent('En progreso');
  });

  it('omits the pickup location line when null', () => {
    render(<PickupMobileManifestCard {...baseProps} pickupLocation={null} />);
    expect(screen.queryByText('Easy Vespucio')).not.toBeInTheDocument();
  });

  describe('non-selectable (route-manifest) mode', () => {
    it('the whole card opens the manifest on click', async () => {
      const onOpen = vi.fn();
      render(<PickupMobileManifestCard {...baseProps} onOpen={onOpen} />);
      await userEvent.click(screen.getByTestId('mobile-manifest-card'));
      expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it('is a real button with an adequate touch target', () => {
      render(<PickupMobileManifestCard {...baseProps} />);
      const card = screen.getByTestId('mobile-manifest-card');
      expect(card.tagName).toBe('BUTTON');
      expect(card.className).toMatch(/min-h-\[76px\]/);
    });
  });

  describe('selectable (pending/draft) mode', () => {
    it('renders selection and open as two sibling controls, not nested', () => {
      render(<PickupMobileManifestCard {...baseProps} selectable selected={false} onSelect={vi.fn()} />);
      const checkbox = screen.getByRole('checkbox', { name: 'Seleccionar CARGA-99814' });
      const openButton = screen.getByTestId('mobile-manifest-open');
      // Sibling relationship: neither contains the other.
      expect(checkbox.contains(openButton)).toBe(false);
      expect(openButton.contains(checkbox)).toBe(false);
      expect(checkbox).toHaveAttribute('aria-checked', 'false');
    });

    // spec-54 3h review fix, round 3, item 2 — aria-label on the checkbox
    // and the open button overrides their accessible name from content, so
    // the retailer, pickup location, counts and status badge (all inside
    // the labelled checkbox) were announced nowhere. aria-describedby
    // exposes them as a reachable description on both controls.
    it('exposes the retailer, counts and status badge as an accessible description on both controls', () => {
      render(
        <PickupMobileManifestCard
          {...baseProps}
          selectable
          selected={false}
          onSelect={vi.fn()}
          statusLabel="En progreso"
        />,
      );
      const checkbox = screen.getByRole('checkbox', { name: 'Seleccionar CARGA-99814' });
      const openButton = screen.getByTestId('mobile-manifest-open');

      expect(checkbox).toHaveAccessibleDescription(/Easy/);
      expect(checkbox).toHaveAccessibleDescription(/En progreso/);
      expect(openButton).toHaveAccessibleDescription(/Easy/);
      expect(openButton).toHaveAccessibleDescription(/En progreso/);
    });

    it('tapping the checkbox toggles selection', async () => {
      const onSelect = vi.fn();
      render(
        <PickupMobileManifestCard {...baseProps} selectable selected={false} onSelect={onSelect} />,
      );
      await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar CARGA-99814' }));
      expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('reflects the selected state in aria-checked', () => {
      render(<PickupMobileManifestCard {...baseProps} selectable selected onSelect={vi.fn()} />);
      expect(screen.getByRole('checkbox', { name: 'Seleccionar CARGA-99814' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    });

    it('shows a visible check glyph when selected — selection is not colour-only (WCAG 1.4.1)', () => {
      const { rerender } = render(
        <PickupMobileManifestCard {...baseProps} selectable selected={false} onSelect={vi.fn()} />,
      );
      const checkbox = () => screen.getByRole('checkbox', { name: 'Seleccionar CARGA-99814' });
      // Scope to the check glyph specifically — the checkbox also contains
      // the pickup-location pin icon, which is unrelated to selection state.
      expect(checkbox().querySelector('.lucide-check')).not.toBeInTheDocument();

      rerender(<PickupMobileManifestCard {...baseProps} selectable selected onSelect={vi.fn()} />);
      expect(checkbox().querySelector('.lucide-check')).toBeInTheDocument();
    });

    it('tapping the open button opens the manifest without toggling selection', async () => {
      const onSelect = vi.fn();
      const onOpen = vi.fn();
      render(
        <PickupMobileManifestCard
          {...baseProps}
          selectable
          onSelect={onSelect}
          onOpen={onOpen}
        />,
      );
      await userEvent.click(screen.getByTestId('mobile-manifest-open'));
      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('both the checkbox and the open button meet the 44px touch target minimum', () => {
      render(<PickupMobileManifestCard {...baseProps} selectable selected={false} onSelect={vi.fn()} />);
      const checkbox = screen.getByRole('checkbox', { name: 'Seleccionar CARGA-99814' });
      const openButton = screen.getByTestId('mobile-manifest-open');
      expect(checkbox.className).toMatch(/min-h-\[76px\]/);
      expect(openButton.className).toMatch(/min-h-\[76px\]/);
      expect(openButton.className).toMatch(/w-11/); // 44px
    });
  });
});
