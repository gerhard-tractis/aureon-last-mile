import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActiveRouteBanner } from './ActiveRouteBanner';

describe('ActiveRouteBanner', () => {
  it('renders code, manifest count and Ver ruta link', () => {
    render(
      <ActiveRouteBanner
        code="PR-2026-0042"
        startedAt="2026-06-25T10:30:00Z"
        manifestCount={3}
      />
    );
    expect(screen.getByText('PR-2026-0042')).toBeInTheDocument();
    expect(screen.getByText(/3 manifiestos/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Ver ruta/i });
    expect(link).toHaveAttribute('href', '/app/pickup/route/active');
  });
});
