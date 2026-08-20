import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PickupMobileHeader } from './PickupMobileHeader';

describe('PickupMobileHeader', () => {
  it('renders the title, date, driver name and route code in one subtitle line', () => {
    render(
      <PickupMobileHeader
        driverName="M. Rojas"
        routeCode="PR-2026-0148"
        now={new Date('2026-08-13T12:00:00')}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Recogidas de hoy' })).toBeInTheDocument();
    const subtitle = screen.getByTestId('mobile-header-subtitle');
    expect(subtitle).toHaveTextContent('13/08');
    expect(subtitle).toHaveTextContent('M. Rojas');
    expect(subtitle).toHaveTextContent('PR-2026-0148');
  });

  it('shows the driver initials in a round avatar', () => {
    render(
      <PickupMobileHeader
        driverName="M. Rojas"
        routeCode="PR-2026-0148"
        now={new Date('2026-08-13T12:00:00')}
      />,
    );
    expect(screen.getByTestId('mobile-header-avatar')).toHaveTextContent('MR');
  });

  it('never fabricates a driver name when none is available', () => {
    render(
      <PickupMobileHeader
        driverName={null}
        routeCode="PR-2026-0148"
        now={new Date('2026-08-13T12:00:00')}
      />,
    );
    const subtitle = screen.getByTestId('mobile-header-subtitle');
    expect(subtitle).toHaveTextContent('PR-2026-0148');
    expect(screen.getByTestId('mobile-header-avatar')).toHaveTextContent('··');
  });

  // 3j (no active route yet) — there is no route to name. No trailing " · "
  // separator or empty segment should render.
  it('omits the route-code segment cleanly when there is no active route', () => {
    render(
      <PickupMobileHeader
        driverName="Marcela R."
        routeCode={null}
        now={new Date('2026-08-13T12:00:00')}
      />,
    );
    const subtitle = screen.getByTestId('mobile-header-subtitle');
    expect(subtitle).toHaveTextContent('Marcela R. · jue 13/08');
    expect(subtitle.textContent?.trim().endsWith('·')).toBe(false);
  });

  // Review fix — the 3j artboard is explicit: "Marcela R. · mié 13/08"
  // (driver first, then date). The presence-only checks above would not
  // catch a regression back to date-first, so pin the actual order.
  it('orders the subtitle driver-first, then date, then route code', () => {
    render(
      <PickupMobileHeader
        driverName="Marcela R."
        routeCode="PR-2026-0148"
        now={new Date('2026-08-13T12:00:00')}
      />,
    );
    const subtitle = screen.getByTestId('mobile-header-subtitle');
    expect(subtitle.textContent).toBe('Marcela R. · jue 13/08 · PR-2026-0148');
  });
});
