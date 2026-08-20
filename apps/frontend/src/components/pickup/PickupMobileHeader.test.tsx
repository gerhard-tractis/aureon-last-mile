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
});
