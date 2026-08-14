import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StageRail } from './StageRail';

const STAGES = [
  { key: 'pickup' as const, count: 5, delta: '+2', health: 'ok' as const },
  { key: 'reception' as const, count: 3, delta: '0', health: 'warn' as const },
  { key: 'consolidation' as const, count: 0, delta: '—', health: 'neutral' as const },
  { key: 'docks' as const, count: 2, delta: '-1', health: 'crit' as const },
  { key: 'delivery' as const, count: 8, delta: '+3', health: 'ok' as const },
  { key: 'returns' as const, count: 1, delta: '0', health: 'warn' as const },
  { key: 'reverse' as const, count: 0, delta: '—', health: 'neutral' as const },
];

describe('StageRail', () => {
  it('renders all 7 stages in flow order', () => {
    render(<StageRail stages={STAGES} activeStage={null} onStageChange={() => {}} />);
    expect(screen.getAllByRole('button')).toHaveLength(7);
    expect(screen.getByText('Recogida')).toBeInTheDocument();
    expect(screen.getByText('Cambios y Devoluciones')).toBeInTheDocument();
  });

  it('shows the count for each stage', () => {
    render(<StageRail stages={STAGES} activeStage={null} onStageChange={() => {}} />);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('marks the selected stage with aria-pressed and calls back on click', async () => {
    const fn = vi.fn();
    const { rerender } = render(
      <StageRail stages={STAGES} activeStage={null} onStageChange={fn} />,
    );
    await userEvent.click(screen.getAllByRole('button')[0]);
    expect(fn).toHaveBeenCalledWith('pickup');

    rerender(<StageRail stages={STAGES} activeStage="pickup" onStageChange={fn} />);
    expect(screen.getAllByRole('button')[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('carries health on a foot bar, not a left border', () => {
    // Across seven narrow columns a left border reads as a divider between
    // cards rather than a property of one.
    render(<StageRail stages={STAGES} activeStage={null} onStageChange={() => {}} />);
    expect(screen.getByTestId('stage-health-pickup').className).toContain('bg-status-success');
    expect(screen.getByTestId('stage-health-reception').className).toContain('bg-status-warning');
    expect(screen.getByTestId('stage-health-docks').className).toContain('bg-status-error');
    expect(screen.getByTestId('stage-health-reverse').className).toContain('bg-border');
  });

  it('tints the card body for stages that need attention', () => {
    render(<StageRail stages={STAGES} activeStage={null} onStageChange={() => {}} />);
    const [, reception, , docks] = screen.getAllByRole('button');
    expect(reception.className).toContain('bg-status-warning-bg');
    expect(docks.className).toContain('bg-status-error-bg');
  });

  it('marks selection with the brand accent, never the info blue', () => {
    // Blue competed with the status colours: a selected healthy stage and a
    // stage in trouble both looked "marked".
    render(<StageRail stages={STAGES} activeStage="delivery" onStageChange={() => {}} />);
    const selected = screen.getAllByRole('button')[4];
    expect(selected.className).toContain('border-accent');
    expect(selected.className).not.toContain('status-info');
  });

  it('lets selection win over the health tint on the same card', () => {
    render(<StageRail stages={STAGES} activeStage="docks" onStageChange={() => {}} />);
    const docks = screen.getAllByRole('button')[3];
    expect(docks.className).toContain('bg-accent-muted');
    expect(docks.className).not.toContain('bg-status-error-bg');
  });

  it('still renders a stage the caller omitted, as neutral zero', () => {
    render(<StageRail stages={[STAGES[0]]} activeStage={null} onStageChange={() => {}} />);
    expect(screen.getAllByRole('button')).toHaveLength(7);
    expect(screen.getByTestId('stage-health-delivery').className).toContain('bg-border');
  });
});
