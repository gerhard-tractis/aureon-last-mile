import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock the hook before importing the component
vi.mock('@/hooks/dashboard/useNorthStars', () => ({
  useNorthStars: vi.fn(() => ({ data: null, isLoading: false })),
}));

import { NorthStarStrip } from './NorthStarStrip';

const DEFAULT_PROPS = { operatorId: 'op-1', year: 2026, month: 4 };

describe('NorthStarStrip', () => {
  it('renders 4 cards with the correct labels', () => {
    render(<NorthStarStrip {...DEFAULT_PROPS} />);
    expect(screen.getByText('CPO')).toBeInTheDocument();
    expect(screen.getByText('OTIF')).toBeInTheDocument();
    expect(screen.getByText('NPS · CSAT')).toBeInTheDocument();
    expect(screen.getByText('Órdenes')).toBeInTheDocument();
  });

  it('has grid grid-cols-2 md:grid-cols-4 class', () => {
    const { container } = render(<NorthStarStrip {...DEFAULT_PROPS} />);
    const grid = container.firstChild as HTMLElement;
    expect(grid.className).toMatch(/grid/);
    expect(grid.className).toMatch(/grid-cols-2/);
    expect(grid.className).toMatch(/md:grid-cols-4/);
  });

  it('has md:sticky md:top-0 class on the wrapper', () => {
    const { container } = render(<NorthStarStrip {...DEFAULT_PROPS} />);
    const grid = container.firstChild as HTMLElement;
    expect(grid.className).toMatch(/md:sticky/);
    expect(grid.className).toMatch(/md:top-0/);
  });

  it('CPO card uses mode="placeholder"', () => {
    render(<NorthStarStrip {...DEFAULT_PROPS} />);
    // Placeholder cards show the Próximamente badge
    const badges = screen.getAllByText('Próximamente');
    // CPO and NPS are placeholders → 2 badges
    expect(badges.length).toBeGreaterThanOrEqual(2);
  });

  it('OTIF card uses mode="live" (no Próximamente badge for it)', () => {
    render(<NorthStarStrip {...DEFAULT_PROPS} />);
    // Only 2 placeholders (CPO + NPS), not 4
    const badges = screen.getAllByText('Próximamente');
    expect(badges.length).toBe(2);
  });
});
