import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StageCell } from './StageCell';
import type { StageKey } from '@/app/app/operations-control/lib/labels.es';
import { STAGE_LABELS } from '@/app/app/operations-control/lib/labels.es';

describe('StageCell', () => {
  const defaultProps = {
    stageKey: 'delivery' as StageKey,
    index: 5,
    count: 42,
    delta: '+3',
    health: 'ok' as const,
    isSelected: false,
    onSelect: vi.fn(),
  };

  it('renders numeric index padded to 2 digits', () => {
    render(<StageCell {...defaultProps} index={1} />);
    expect(screen.getByText('01')).toBeDefined();
  });

  it('renders Spanish stage name from STAGE_LABELS', () => {
    render(<StageCell {...defaultProps} stageKey="delivery" />);
    expect(screen.getByText(STAGE_LABELS.delivery)).toBeDefined();
  });

  it('renders the count in tabular mono font', () => {
    render(<StageCell {...defaultProps} count={99} />);
    expect(screen.getByTestId('stage-count')).toBeDefined();
    expect(screen.getByTestId('stage-count').textContent).toBe('99');
  });

  it('renders delta text', () => {
    render(<StageCell {...defaultProps} delta="+7" />);
    expect(screen.getByText('+7')).toBeDefined();
  });

  it('has aria-pressed="false" when not selected', () => {
    render(<StageCell {...defaultProps} isSelected={false} />);
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('has aria-pressed="true" when selected', () => {
    render(<StageCell {...defaultProps} isSelected={true} />);
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('clicking calls onSelect with stageKey', () => {
    const onSelect = vi.fn();
    render(<StageCell {...defaultProps} stageKey="pickup" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledWith('pickup');
  });

  it('root element is a <button>', () => {
    render(<StageCell {...defaultProps} />);
    expect(screen.getByRole('button').tagName).toBe('BUTTON');
  });

  it('applies data-health attribute for ok health', () => {
    render(<StageCell {...defaultProps} health="ok" />);
    expect(screen.getByRole('button').getAttribute('data-health')).toBe('ok');
  });

  it('applies data-health attribute for warn health', () => {
    render(<StageCell {...defaultProps} health="warn" />);
    expect(screen.getByRole('button').getAttribute('data-health')).toBe('warn');
  });

  it('applies data-health attribute for crit health', () => {
    render(<StageCell {...defaultProps} health="crit" />);
    expect(screen.getByRole('button').getAttribute('data-health')).toBe('crit');
  });

  it('applies data-health attribute for neutral health', () => {
    render(<StageCell {...defaultProps} health="neutral" />);
    expect(screen.getByRole('button').getAttribute('data-health')).toBe('neutral');
  });
});
