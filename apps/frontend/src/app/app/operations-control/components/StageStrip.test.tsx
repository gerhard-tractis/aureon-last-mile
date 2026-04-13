import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StageStrip } from './StageStrip';

const STAGES = [
  { key: 'pickup' as const, count: 5, delta: '+2', health: 'ok' as const },
  { key: 'reception' as const, count: 3, delta: '0', health: 'warn' as const },
  { key: 'consolidation' as const, count: 0, delta: '—', health: 'neutral' as const },
  { key: 'docks' as const, count: 2, delta: '-1', health: 'crit' as const },
  { key: 'delivery' as const, count: 8, delta: '+3', health: 'ok' as const },
  { key: 'returns' as const, count: 1, delta: '0', health: 'warn' as const },
  { key: 'reverse' as const, count: 0, delta: '—', health: 'neutral' as const },
];

describe('StageStrip', () => {
  it('renders 7 stage buttons', () => {
    render(<StageStrip stages={STAGES} activeStage={null} onStageChange={() => {}} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(7);
  });

  it('shows count for each stage', () => {
    render(<StageStrip stages={STAGES} activeStage={null} onStageChange={() => {}} />);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('marks selected stage with aria-pressed', () => {
    render(<StageStrip stages={STAGES} activeStage="pickup" onStageChange={() => {}} />);
    const pickup = screen.getAllByRole('button')[0];
    expect(pickup).toHaveAttribute('aria-pressed', 'true');
  });

  it('calls onStageChange when clicked', async () => {
    const fn = vi.fn();
    render(<StageStrip stages={STAGES} activeStage={null} onStageChange={fn} />);
    await userEvent.click(screen.getAllByRole('button')[0]);
    expect(fn).toHaveBeenCalledWith('pickup');
  });
});
