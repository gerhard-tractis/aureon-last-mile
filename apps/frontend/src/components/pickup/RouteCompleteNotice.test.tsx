import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RouteCompleteNotice } from './RouteCompleteNotice';

describe('RouteCompleteNotice', () => {
  it('states the route is fully verified without offering a Verificar action', () => {
    render(<RouteCompleteNotice />);
    expect(screen.getByText(/todo.*verificado/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /verificar/i })).toBeNull();
  });
});
