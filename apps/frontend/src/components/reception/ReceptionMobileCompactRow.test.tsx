import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReceptionMobileCompactRow } from './ReceptionMobileCompactRow';
import { YARD_WAIT_WARNING_MINUTES } from '@/app/app/reception/arrivals';
import type { IncomingRoute } from '@/hooks/reception/useIncomingRoutes';

function buildRoute(overrides: Partial<IncomingRoute> = {}): IncomingRoute {
  return {
    id: 'route-1',
    code: 'R-1042',
    driver_id: 'driver-1',
    driver_name: 'M. Rojas',
    plate: 'ABCD12',
    in_transit_at: '2026-08-20T10:00:00.000Z',
    started_at: '2026-08-20T09:30:00.000Z',
    manifest_count: 1,
    expected_packages: 18,
    ...overrides,
  };
}

describe('ReceptionMobileCompactRow', () => {
  it('renders the route code', () => {
    render(
      <ReceptionMobileCompactRow route={buildRoute()} waitingMinutes={12} onOpen={vi.fn()} />,
    );

    expect(screen.getByText('R-1042')).toBeInTheDocument();
  });

  it('renders the expected package count as "N paquetes"', () => {
    render(
      <ReceptionMobileCompactRow
        route={buildRoute({ expected_packages: 18 })}
        waitingMinutes={12}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByTestId('compact-row-packages')).toHaveTextContent(/^18 paquetes$/);
  });

  it('renders the wait label when waitingMinutes is present', () => {
    render(
      <ReceptionMobileCompactRow route={buildRoute()} waitingMinutes={12} onOpen={vi.fn()} />,
    );

    expect(screen.getByText('12 min')).toBeInTheDocument();
  });

  it('renders no wait text when waitingMinutes is null', () => {
    render(
      <ReceptionMobileCompactRow route={buildRoute()} waitingMinutes={null} onOpen={vi.fn()} />,
    );

    expect(screen.queryByText(/min$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d+ h/)).not.toBeInTheDocument();
  });

  it('marks an overdue wait with the warning palette and an AlertTriangle icon, not colour alone', () => {
    render(
      <ReceptionMobileCompactRow
        route={buildRoute()}
        waitingMinutes={YARD_WAIT_WARNING_MINUTES}
        onOpen={vi.fn()}
      />,
    );

    // Warning, not error: 30 minutes is an attention threshold, not a
    // failure, and matches the shipped desktop ArrivalsPanel's palette for
    // the identical condition — see spec-62 for the deliberate deviation
    // from the mock's error-red badge.
    const badge = screen.getByTestId('compact-row-wait-badge');
    expect(badge.className).toMatch(/status-warning/);
    expect(badge.querySelector('svg')).not.toBeNull();
  });

  it('does not mark a normal wait with the warning palette or an icon', () => {
    render(
      <ReceptionMobileCompactRow
        route={buildRoute()}
        waitingMinutes={YARD_WAIT_WARNING_MINUTES - 1}
        onOpen={vi.fn()}
      />,
    );

    const badge = screen.getByTestId('compact-row-wait-badge');
    expect(badge.className).not.toMatch(/status-warning/);
    expect(badge.querySelector('svg')).toBeNull();
  });

  it('renders the row as a real button with a min-h-[56px] touch target', () => {
    render(
      <ReceptionMobileCompactRow route={buildRoute()} waitingMinutes={12} onOpen={vi.fn()} />,
    );

    const button = screen.getByRole('button');
    expect(button.className).toMatch(/min-h-\[56px\]/);
  });

  it('fires onOpen when the row is clicked anywhere, not just the chevron', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <ReceptionMobileCompactRow route={buildRoute()} waitingMinutes={12} onOpen={onOpen} />,
    );

    await user.click(screen.getByText('R-1042'));

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('fires onOpen when the button itself is activated via keyboard', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <ReceptionMobileCompactRow route={buildRoute()} waitingMinutes={12} onOpen={onOpen} />,
    );

    await user.tab();
    expect(screen.getByRole('button')).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
