import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ManifestSearchBar } from './ManifestSearchBar';

describe('ManifestSearchBar', () => {
  it('uses the mock copy on the default tabs', () => {
    render(<ManifestSearchBar value="" onChange={vi.fn()} tab="pending" />);
    expect(
      screen.getByPlaceholderText('Buscar carga, punto de recogida o cliente en este módulo'),
    ).toBeInTheDocument();
  });

  // m1 (review round 1) — restored from 4bd1c02. matchesSearchTermRouted
  // (pickupPageHelpers.ts) still matches route_code/driver_name on the
  // routed tab; a shared placeholder that never names those fields makes
  // the bar lie about what it can find (its own docstring says so).
  it('announces route code and leader on the routed tab', () => {
    render(<ManifestSearchBar value="" onChange={vi.fn()} tab="routed" />);
    expect(
      screen.getByPlaceholderText('Buscar por carga, retailer, ruta o líder…'),
    ).toBeInTheDocument();
  });

  it('reports changes as the caller types', async () => {
    const onChange = vi.fn();
    render(<ManifestSearchBar value="" onChange={onChange} tab="pending" />);
    await userEvent.type(screen.getByPlaceholderText(/Buscar carga/), 'a');
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('shows a clear button only once there is a query, and it clears it', async () => {
    const onChange = vi.fn();
    render(<ManifestSearchBar value="CARGA-1" onChange={onChange} tab="pending" />);
    await userEvent.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('hides the clear button when empty', () => {
    render(<ManifestSearchBar value="" onChange={vi.fn()} tab="pending" />);
    expect(screen.queryByRole('button', { name: 'Limpiar búsqueda' })).toBeNull();
  });
});
