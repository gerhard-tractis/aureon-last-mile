import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PickupMobileFooterActions } from './PickupMobileFooterActions';

describe('PickupMobileFooterActions', () => {
  it('shows "Buscar carga" when search is closed', () => {
    render(<PickupMobileFooterActions searchOpen={false} onToggleSearch={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Buscar carga' })).toBeInTheDocument();
  });

  it('shows "Cerrar búsqueda" when search is open — this state is reachable, not dead code', () => {
    render(<PickupMobileFooterActions searchOpen={true} onToggleSearch={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Cerrar búsqueda' })).toBeInTheDocument();
  });

  it('calls onToggleSearch when pressed', async () => {
    const onToggleSearch = vi.fn();
    render(<PickupMobileFooterActions searchOpen={false} onToggleSearch={onToggleSearch} />);
    await userEvent.click(screen.getByRole('button', { name: 'Buscar carga' }));
    expect(onToggleSearch).toHaveBeenCalledTimes(1);
  });

  it('is at least 44px tall for touch', () => {
    render(<PickupMobileFooterActions searchOpen={false} onToggleSearch={vi.fn()} />);
    expect(screen.getByRole('button').className).toMatch(/min-h-\[44px\]/);
  });
});
