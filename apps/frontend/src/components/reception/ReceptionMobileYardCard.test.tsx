import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReceptionMobileYardCard } from './ReceptionMobileYardCard';
import { YARD_WAIT_WARNING_MINUTES } from '@/app/app/reception/arrivals';
import type { IncomingRoute } from '@/hooks/reception/useIncomingRoutes';

const route: IncomingRoute = {
  id: 'r1',
  code: 'PR-2026-0148',
  driver_id: 'd1',
  driver_name: 'Marcela Rojas',
  plate: 'JKLM-42',
  in_transit_at: '2026-08-20T12:00:00Z',
  started_at: null,
  manifest_count: 3,
  expected_packages: 88,
};

describe('ReceptionMobileYardCard', () => {
  it('names the route, the driver, the plate and what is expected', () => {
    render(<ReceptionMobileYardCard route={route} waitingMinutes={41} onStart={vi.fn()} />);
    expect(screen.getByText('PR-2026-0148')).toBeInTheDocument();
    // The plate is what the receptionist physically checks against the
    // truck in front of them — that's why the card takes the raw
    // IncomingRoute rather than the ArrivalRow, which drops it.
    expect(screen.getByText(/JKLM-42/)).toBeInTheDocument();
    expect(screen.getByText(/Marcela Rojas/)).toBeInTheDocument();
    expect(screen.getByText('88')).toBeInTheDocument();
    expect(screen.getByText('41 min')).toBeInTheDocument();
  });

  it('the primary action opens the count and measures 64px', async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    render(<ReceptionMobileYardCard route={route} waitingMinutes={41} onStart={onStart} />);
    const button = screen.getByRole('button', { name: /Iniciar conteo/ });
    expect(button.tagName).toBe('BUTTON');
    expect(button.className).toContain('h-16');
    await user.click(button);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('with no registered plate, leaves no orphan separator', () => {
    render(
      <ReceptionMobileYardCard route={{ ...route, plate: null }} waitingMinutes={5} onStart={vi.fn()} />,
    );
    expect(screen.getByTestId('yard-card-driver').textContent).not.toMatch(/·\s*$/);
  });

  it('below the threshold, the wait badge uses the neutral palette with no warning icon', () => {
    render(
      <ReceptionMobileYardCard
        route={route}
        waitingMinutes={YARD_WAIT_WARNING_MINUTES - 1}
        onStart={vi.fn()}
      />,
    );
    const badge = screen.getByTestId('yard-card-wait-badge');
    // Positive assertion, not just "no error token": a badge with an empty
    // className would also satisfy `not.toContain('status-error')`.
    expect(badge.className).toContain('border-border');
    expect(badge.className).not.toContain('status-error');
    expect(badge.querySelector('svg')).not.toBeInTheDocument();
  });

  it('at or over the threshold, the wait badge uses the error palette and a warning icon', () => {
    render(
      <ReceptionMobileYardCard
        route={route}
        waitingMinutes={YARD_WAIT_WARNING_MINUTES}
        onStart={vi.fn()}
      />,
    );
    const badge = screen.getByTestId('yard-card-wait-badge');
    expect(badge.className).toContain('status-error');
    // Colour is not the only channel: a colour-blind receptionist standing
    // in the yard must still be able to tell this badge apart by shape.
    expect(badge.querySelector('svg')).toBeInTheDocument();
  });
});
