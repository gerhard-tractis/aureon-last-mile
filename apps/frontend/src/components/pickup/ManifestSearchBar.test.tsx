import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ManifestSearchBar } from './ManifestSearchBar';

describe('ManifestSearchBar', () => {
  it('uses the mock copy', () => {
    render(<ManifestSearchBar value="" onChange={vi.fn()} />);
    expect(
      screen.getByPlaceholderText('Buscar carga, punto de recogida o cliente en este módulo'),
    ).toBeInTheDocument();
  });

  it('reports changes as the caller types', async () => {
    const onChange = vi.fn();
    render(<ManifestSearchBar value="" onChange={onChange} />);
    await userEvent.type(screen.getByPlaceholderText(/Buscar carga/), 'a');
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('shows a clear button only once there is a query, and it clears it', async () => {
    const onChange = vi.fn();
    render(<ManifestSearchBar value="CARGA-1" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('hides the clear button when empty', () => {
    render(<ManifestSearchBar value="" onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Limpiar búsqueda' })).toBeNull();
  });
});
