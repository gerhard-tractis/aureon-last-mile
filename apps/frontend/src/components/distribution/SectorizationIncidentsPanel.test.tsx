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

  // Review fix — page.tsx passed no loading state, and the counts default
  // to 0 while their queries resolve, so a floor lead with a real backlog
  // saw a green "Sin incidencias" for a beat before the real rows
  // appeared. That is the "a zero reads as none" failure the spec warns
  // about, reached by a different route than a placeholder prop.
  it('shows a loading state instead of "Sin incidencias" while its sources are still loading', () => {
    render(
      <SectorizationIncidentsPanel
        unmatchedComunaCount={0}
        noDockCount={0}
        onResolve={vi.fn()}
        isLoading
      />,
    );
    expect(screen.getByTestId('incident-panel-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('incident-panel-empty')).toBeNull();
  });

  it('still shows the real rows while loading if counts are already known to be non-zero', () => {
    // isLoading only guards the FIRST resolve; once rows exist, don't hide
    // them behind a loading skeleton on every background refetch.
    render(
      <SectorizationIncidentsPanel
        unmatchedComunaCount={4}
        noDockCount={0}
        onResolve={vi.fn()}
        isLoading
      />,
    );
    expect(screen.getByTestId('incident-unmatched-comuna')).toBeInTheDocument();
    expect(screen.queryByTestId('incident-panel-loading')).toBeNull();
  });
});
