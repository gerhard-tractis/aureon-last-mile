import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrderComunaChipsFilter } from './OrderComunaChipsFilter';

describe('OrderComunaChipsFilter', () => {
  it('renders one removable chip per comuna', () => {
    render(<OrderComunaChipsFilter comunas={['La Florida', 'Ñuñoa']} onChange={vi.fn()} />);
    expect(screen.getByText(/La Florida/)).toBeInTheDocument();
    expect(screen.getByText(/Ñuñoa/)).toBeInTheDocument();
  });

  it('removing a chip drops only that comuna, and clears to null when it was the last one', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<OrderComunaChipsFilter comunas={['La Florida', 'Ñuñoa']} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /quitar la florida/i }));
    expect(onChange).toHaveBeenCalledWith(['Ñuñoa']);
  });

  it('removing the last comuna sets comunas to null, not an empty array', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<OrderComunaChipsFilter comunas={['La Florida']} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /quitar la florida/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('"+ añadir" reveals a text input; Enter commits a new comuna, appended to the existing list', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<OrderComunaChipsFilter comunas={['La Florida']} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /añadir/i }));
    const input = screen.getByRole('textbox', { name: /nueva zona/i });
    await user.type(input, 'Ñuñoa{Enter}');
    expect(onChange).toHaveBeenCalledWith(['La Florida', 'Ñuñoa']);
  });

  it('does not add a duplicate comuna', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<OrderComunaChipsFilter comunas={['La Florida']} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /añadir/i }));
    const input = screen.getByRole('textbox', { name: /nueva zona/i });
    await user.type(input, 'La Florida{Enter}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('starting from no comunas at all still works', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<OrderComunaChipsFilter comunas={null} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /añadir/i }));
    const input = screen.getByRole('textbox', { name: /nueva zona/i });
    await user.type(input, 'Maipú{Enter}');
    expect(onChange).toHaveBeenCalledWith(['Maipú']);
  });
});
