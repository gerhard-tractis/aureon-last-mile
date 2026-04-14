import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReversePlaceholderPanel } from './ReversePlaceholderPanel';

// ReversePlaceholderPanel does not call useStageBreakdown, but mock it anyway
// in case any transitive import tries to use it.
vi.mock('@/hooks/ops-control/useStageBreakdown', () => ({
  useStageBreakdown: vi.fn(),
}));

describe('ReversePlaceholderPanel', () => {
  const defaultProps = { operatorId: 'op-1', lastSyncAt: null };

  it('renders title "Cambios y Devoluciones"', () => {
    render(<ReversePlaceholderPanel {...defaultProps} />);
    expect(screen.getByTestId('drilldown-title').textContent).toBe('Cambios y Devoluciones');
  });

  it('renders "Próximamente" placeholder content', () => {
    render(<ReversePlaceholderPanel {...defaultProps} />);
    // There is one in the subtitle and one in the body — at least one must be present
    const matches = screen.getAllByText('Próximamente');
    expect(matches.length).toBeGreaterThan(0);
  });

  it('renders a disabled button (no module yet)', () => {
    render(<ReversePlaceholderPanel {...defaultProps} />);
    const btn = screen.getByRole('button', { name: /próximamente/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});
