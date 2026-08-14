import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DockCard } from './DockCard';

const BASE = {
  code: 'A3',
  zoneName: 'Sur Oriente',
  comunas: ['La Florida', 'Puente Alto', 'La Pintana'],
  packageCount: 176,
  routeCount: 2,
  occupancyPct: 36,
};

describe('DockCard', () => {
  it('renders code, zone, comunas and counts', () => {
    render(<DockCard {...BASE} />);
    expect(screen.getByText('A3')).toBeInTheDocument();
    expect(screen.getByText('Sur Oriente')).toBeInTheDocument();
    expect(screen.getByText('La Florida · Puente Alto · La Pintana')).toBeInTheDocument();
    expect(screen.getByText('176')).toBeInTheDocument();
    expect(screen.getByText('paquetes · 2 rutas')).toBeInTheDocument();
  });

  it('singularises the route count', () => {
    render(<DockCard {...BASE} routeCount={1} />);
    expect(screen.getByText('paquetes · 1 ruta')).toBeInTheDocument();
  });

  it('marks the last-scanned dock with an ACTIVO badge, not colour alone', () => {
    render(<DockCard {...BASE} active />);
    expect(screen.getByText('ACTIVO')).toBeInTheDocument();
  });

  it('shows no ACTIVO badge when inactive', () => {
    render(<DockCard {...BASE} />);
    expect(screen.queryByText('ACTIVO')).toBeNull();
  });

  it('renders the consolidation dock in the warning palette', () => {
    // CO is not a dock you deliver to — it is where incomplete orders wait for
    // their siblings, so it must not read as just another zone.
    const { container } = render(
      <DockCard code="CO" zoneName="Consolidación" tone="warning" packageCount={46} routeCount={0} />,
    );
    expect(container.firstElementChild!.className).toContain('bg-status-warning-bg');
  });

  it('clamps the occupancy bar to 0–100', () => {
    render(<DockCard {...BASE} occupancyPct={140} />);
    expect(screen.getByTestId('dock-occupancy').style.width).toBe('100%');
  });

  it('treats a missing occupancy as zero rather than NaN', () => {
    render(<DockCard {...BASE} occupancyPct={undefined} />);
    expect(screen.getByTestId('dock-occupancy').style.width).toBe('0%');
  });

  it('is only a button when it can be clicked', () => {
    const onClick = vi.fn();
    const { rerender } = render(<DockCard {...BASE} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalled();

    rerender(<DockCard {...BASE} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
