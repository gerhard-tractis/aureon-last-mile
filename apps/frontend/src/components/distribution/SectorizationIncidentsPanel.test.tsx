import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { SectorizationIncidentsPanel } from './SectorizationIncidentsPanel';

describe('SectorizationIncidentsPanel', () => {
  it('renders three distinct rows, each with its own independent count', () => {
    render(
      <SectorizationIncidentsPanel
        unmatchedComunaCount={4}
        noDockCount={3}
        wrongDockCount={2}
        onResolve={vi.fn()}
      />,
    );

    const unmatched = screen.getByTestId('incident-unmatched-comuna');
    const noDock = screen.getByTestId('incident-no-dock');
    const wrongDock = screen.getByTestId('incident-wrong-dock');

    expect(within(unmatched).getByText('4')).toBeInTheDocument();
    expect(within(noDock).getByText('3')).toBeInTheDocument();
    expect(within(wrongDock).getByText('2')).toBeInTheDocument();
  });

  it('renders a footer action that triggers onResolve', () => {
    const onResolve = vi.fn();
    render(
      <SectorizationIncidentsPanel
        unmatchedComunaCount={1}
        noDockCount={0}
        wrongDockCount={0}
        onResolve={onResolve}
      />,
    );
    screen.getByTestId('incident-panel-resolve').click();
    expect(onResolve).toHaveBeenCalledTimes(1);
  });

  it('omits the wrong-dock row entirely when its count has no source (undefined)', () => {
    render(
      <SectorizationIncidentsPanel unmatchedComunaCount={1} noDockCount={0} onResolve={vi.fn()} />,
    );
    expect(screen.getByTestId('incident-unmatched-comuna')).toBeInTheDocument();
    expect(screen.getByTestId('incident-no-dock')).toBeInTheDocument();
    expect(screen.queryByTestId('incident-wrong-dock')).toBeNull();
  });

  it('renders an empty state when every sourced count is zero', () => {
    render(<SectorizationIncidentsPanel unmatchedComunaCount={0} noDockCount={0} onResolve={vi.fn()} />);
    expect(screen.queryByTestId('incident-unmatched-comuna')).toBeNull();
    expect(screen.queryByTestId('incident-no-dock')).toBeNull();
    expect(screen.getByTestId('incident-panel-empty')).toBeInTheDocument();
  });
});
