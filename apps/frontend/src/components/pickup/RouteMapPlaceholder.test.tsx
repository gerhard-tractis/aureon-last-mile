import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RouteMapPlaceholder } from './RouteMapPlaceholder';

describe('RouteMapPlaceholder', () => {
  it('renders a neutral placeholder surface, not a real map', () => {
    render(<RouteMapPlaceholder pickupLocation={null} />);
    expect(screen.getByTestId('route-map-placeholder')).toBeInTheDocument();
    expect(screen.getByText(/mapa no disponible/i)).toBeInTheDocument();
  });

  it('does not render a navigation button when there is no address to navigate to', () => {
    render(<RouteMapPlaceholder pickupLocation={null} />);
    expect(screen.queryByText(/abrir navegaci/i)).toBeNull();
  });

  // spec-54 phase 4.6 fix: manifests.pickup_location IS on the same row this
  // screen already queries — a plain maps search URL needs no map provider.
  it('renders an honest "ABRIR NAVEGACIÓN" link to a maps search when a pickup address is known', () => {
    render(<RouteMapPlaceholder pickupLocation="Av. Providencia 1234, Providencia" />);
    const link = screen.getByRole('link', { name: /abrir navegaci/i });
    expect(link).toHaveAttribute(
      'href',
      'https://maps.google.com/?q=' + encodeURIComponent('Av. Providencia 1234, Providencia'),
    );
  });

  it('has a touch target of at least 44px for the navigation link', () => {
    render(<RouteMapPlaceholder pickupLocation="Av. Providencia 1234, Providencia" />);
    const link = screen.getByRole('link', { name: /abrir navegaci/i });
    expect(link.className).toMatch(/min-h-\[(4[4-9]|5[0-9]|6[0-9])px\]/);
  });
});
