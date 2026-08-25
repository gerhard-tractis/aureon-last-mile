import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DistributionMobileHeader } from './DistributionMobileHeader';

describe('DistributionMobileHeader — greeting variant (4c)', () => {
  it('greets the operator by their first name', () => {
    render(<DistributionMobileHeader userName="Marcela Rojas" />);
    expect(screen.getByText('Hola, Marcela')).toBeInTheDocument();
  });

  it('without a name, greets plainly and leaves no orphan comma or "undefined"', () => {
    render(<DistributionMobileHeader userName={null} />);
    expect(screen.getByText('Hola')).toBeInTheDocument();
    expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument();
  });

  it('shows the module context line, never a fabricated shift', () => {
    // Decisión 9 — "Nave Quilicura · turno 14:00" does not exist in the
    // schema. No "turno" wording anywhere in this header.
    render(<DistributionMobileHeader userName="Marcela Rojas" />);
    expect(screen.getByText('Distribución')).toBeInTheDocument();
    expect(screen.queryByText(/turno/i)).not.toBeInTheDocument();
  });

  it('shows EN LÍNEA when the browser reports it is online', () => {
    render(<DistributionMobileHeader userName="Marcela Rojas" isOnline />);
    expect(screen.getByText('EN LÍNEA')).toBeInTheDocument();
  });

  it('shows SIN CONEXIÓN when the browser reports it is offline', () => {
    render(<DistributionMobileHeader userName="Marcela Rojas" isOnline={false} />);
    expect(screen.getByText('SIN CONEXIÓN')).toBeInTheDocument();
  });

  it('renders the isotype mark', () => {
    render(<DistributionMobileHeader userName="Marcela Rojas" />);
    expect(screen.getByTestId('distribution-mobile-header-isotype')).toBeInTheDocument();
  });

  it('does not render a back arrow in the greeting variant', () => {
    render(<DistributionMobileHeader userName="Marcela Rojas" />);
    expect(screen.queryByRole('button', { name: /volver|atrás/i })).not.toBeInTheDocument();
  });
});

describe('DistributionMobileHeader — titled variant (later phases)', () => {
  it('shows a back arrow, title, subtitle and status chip', async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(
      <DistributionMobileHeader
        variant="titled"
        title="Pendientes de sectorizar"
        subtitle="42 paquetes"
        onBack={onBack}
        statusChip={{ label: 'EN LÍNEA', tone: 'success' }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Pendientes de sectorizar' })).toBeInTheDocument();
    expect(screen.getByText('42 paquetes')).toBeInTheDocument();
    expect(screen.getByText('EN LÍNEA')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /volver/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('does not render the greeting or the isotype in the titled variant', () => {
    render(
      <DistributionMobileHeader
        variant="titled"
        title="Consolidación"
        subtitle="8 paquetes"
        onBack={vi.fn()}
      />,
    );
    expect(screen.queryByText(/^Hola/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('distribution-mobile-header-isotype')).not.toBeInTheDocument();
  });
});
