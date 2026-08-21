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
  it('nombra la ruta, el conductor, la patente y lo que se espera', () => {
    render(<ReceptionMobileYardCard route={route} waitingMinutes={41} onStart={vi.fn()} />);
    expect(screen.getByText('PR-2026-0148')).toBeInTheDocument();
    // La patente es lo que el receptor coteja contra el camión que tiene
    // delante — por eso la tarjeta recibe el IncomingRoute crudo y no el
    // ArrivalRow, que no la propaga.
    expect(screen.getByText(/JKLM-42/)).toBeInTheDocument();
    expect(screen.getByText(/Marcela Rojas/)).toBeInTheDocument();
    expect(screen.getByText('88')).toBeInTheDocument();
    expect(screen.getByText('41 min')).toBeInTheDocument();
  });

  it('la acción primaria abre el conteo y mide 64px', async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    render(<ReceptionMobileYardCard route={route} waitingMinutes={41} onStart={onStart} />);
    const button = screen.getByRole('button', { name: /Iniciar conteo/ });
    expect(button.tagName).toBe('BUTTON');
    expect(button.className).toContain('h-16');
    await user.click(button);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('sin patente registrada no deja un separador huérfano', () => {
    render(
      <ReceptionMobileYardCard route={{ ...route, plate: null }} waitingMinutes={5} onStart={vi.fn()} />,
    );
    expect(screen.getByTestId('yard-card-driver').textContent).not.toMatch(/·\s*$/);
  });

  it('badge de espera bajo el umbral usa paleta neutra, no error', () => {
    render(
      <ReceptionMobileYardCard
        route={route}
        waitingMinutes={YARD_WAIT_WARNING_MINUTES - 1}
        onStart={vi.fn()}
      />,
    );
    const badge = screen.getByTestId('yard-card-wait-badge');
    expect(badge.className).not.toContain('status-error');
  });

  it('badge de espera en o sobre el umbral usa paleta error', () => {
    render(
      <ReceptionMobileYardCard
        route={route}
        waitingMinutes={YARD_WAIT_WARNING_MINUTES}
        onStart={vi.fn()}
      />,
    );
    const badge = screen.getByTestId('yard-card-wait-badge');
    expect(badge.className).toContain('status-error');
  });
});
