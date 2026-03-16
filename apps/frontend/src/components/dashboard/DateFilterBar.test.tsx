import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import DateFilterBar from './DateFilterBar';

const defaultProps = {
  preset: 'today' as const,
  customStart: '',
  customEnd: '',
  onPresetChange: vi.fn(),
  onCustomStartChange: vi.fn(),
  onCustomEndChange: vi.fn(),
};

describe('DateFilterBar', () => {
  it('renders all 7 preset buttons', () => {
    render(<DateFilterBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'Hoy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ayer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Últimos 7 Días' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Esta Semana' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Este Mes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Este Año' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Personalizado' })).toBeInTheDocument();
  });

  it('active preset has gold bg class', () => {
    render(<DateFilterBar {...defaultProps} preset="this_week" />);
    expect(screen.getByRole('button', { name: 'Esta Semana' }).className).toContain('bg-gold');
  });

  it('clicking a preset calls onPresetChange with correct id', async () => {
    const user = userEvent.setup();
    const onPresetChange = vi.fn();
    render(<DateFilterBar {...defaultProps} onPresetChange={onPresetChange} />);
    await user.click(screen.getByRole('button', { name: 'Este Mes' }));
    expect(onPresetChange).toHaveBeenCalledWith('this_month');
  });

  it('shows custom date inputs when preset=custom', () => {
    render(<DateFilterBar {...defaultProps} preset="custom" />);
    expect(screen.getByLabelText('Desde')).toBeInTheDocument();
    expect(screen.getByLabelText('Hasta')).toBeInTheDocument();
  });

  it('does NOT show custom date inputs for non-custom presets', () => {
    render(<DateFilterBar {...defaultProps} preset="today" />);
    expect(screen.queryByLabelText('Desde')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Hasta')).not.toBeInTheDocument();
  });
});
