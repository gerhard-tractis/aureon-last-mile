import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NpsChapter } from './NpsChapter';
import type { DashboardPeriod } from '@/app/app/dashboard/lib/period';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/app/app/dashboard/components/Chapter', () => ({
  Chapter: ({ headline, children }: { headline: string; children: React.ReactNode }) => (
    <div>
      <span data-testid="headline">{headline}</span>
      {children}
    </div>
  ),
}));

vi.mock('@/app/app/dashboard/components/ChapterPlaceholder', () => ({
  ChapterPlaceholder: ({ reason, children }: { reason: string; children?: React.ReactNode }) => (
    <div data-testid="chapter-placeholder">
      <span>—</span>
      <p>{reason}</p>
      {children}
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PERIOD: DashboardPeriod = {
  preset: 'month',
  year: 2026,
  month: 3,
  start: new Date(2026, 2, 1),
  end: new Date(2026, 2, 31, 23, 59, 59),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NpsChapter', () => {
  it('renders headline NPS / CSAT', () => {
    render(<NpsChapter operatorId="op-1" period={PERIOD} />);
    expect(screen.getByTestId('headline')).toHaveTextContent('NPS / CSAT');
  });

  it('renders placeholder hero (ChapterPlaceholder with —)', () => {
    render(<NpsChapter operatorId="op-1" period={PERIOD} />);
    expect(screen.getByTestId('chapter-placeholder')).toBeInTheDocument();
    // Multiple — exist (placeholder + 3 cards), confirm at least one is present
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('renders Incidentes por categoría placeholder card with —', () => {
    render(<NpsChapter operatorId="op-1" period={PERIOD} />);
    expect(screen.getByText('Incidentes por categoría')).toBeInTheDocument();
    expect(screen.getByText('Requiere taxonomía de incidentes')).toBeInTheDocument();
  });

  it('renders Detractores placeholder card with —', () => {
    render(<NpsChapter operatorId="op-1" period={PERIOD} />);
    expect(screen.getByText('Detractores')).toBeInTheDocument();
    expect(screen.getByText('Requiere encuesta post-entrega')).toBeInTheDocument();
  });

  it('renders Temas placeholder card with —', () => {
    render(<NpsChapter operatorId="op-1" period={PERIOD} />);
    expect(screen.getByText('Temas')).toBeInTheDocument();
    expect(screen.getByText('Requiere clasificación LLM de comentarios')).toBeInTheDocument();
  });
});
