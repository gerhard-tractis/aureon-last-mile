/**
 * Tests for PipelineCard component
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PipelineCard } from './PipelineCard';
import type { PipelineStageCount } from '@/hooks/usePipelineCounts';

const makeStage = (overrides: Partial<PipelineStageCount> = {}): PipelineStageCount => ({
  status: 'ingresado',
  count: 10,
  urgent_count: 0,
  alert_count: 0,
  late_count: 0,
  ...overrides,
});

describe('PipelineCard', () => {
  describe('Stage label', () => {
    it('shows Spanish label for ingresado', () => {
      render(<PipelineCard stage={makeStage()} isSelected={false} onClick={vi.fn()} />);
      expect(screen.getByText('Ingresado')).toBeTruthy();
    });

    it('shows Spanish label for en_ruta', () => {
      render(
        <PipelineCard
          stage={makeStage({ status: 'en_ruta', count: 3 })}
          isSelected={false}
          onClick={vi.fn()}
        />,
      );
      expect(screen.getByText('En Ruta')).toBeTruthy();
    });

    it('shows Spanish label for en_bodega', () => {
      render(
        <PipelineCard
          stage={makeStage({ status: 'en_bodega', count: 5 })}
          isSelected={false}
          onClick={vi.fn()}
        />,
      );
      expect(screen.getByText('En Bodega')).toBeTruthy();
    });
  });

  describe('Count display', () => {
    it('shows the count number', () => {
      render(<PipelineCard stage={makeStage({ count: 42 })} isSelected={false} onClick={vi.fn()} />);
      expect(screen.getByTestId('stage-count')).toHaveTextContent('42');
    });

    it('shows 0 count', () => {
      render(<PipelineCard stage={makeStage({ count: 0 })} isSelected={false} onClick={vi.fn()} />);
      expect(screen.getByTestId('stage-count')).toHaveTextContent('0');
    });
  });

  describe('Click behavior', () => {
    it('calls onClick when clicked and count > 0', () => {
      const onClick = vi.fn();
      render(<PipelineCard stage={makeStage({ count: 5 })} isSelected={false} onClick={onClick} />);
      fireEvent.click(screen.getByRole('button'));
      expect(onClick).toHaveBeenCalledOnce();
    });

    it('does not call onClick when count === 0', () => {
      const onClick = vi.fn();
      render(<PipelineCard stage={makeStage({ count: 0 })} isSelected={false} onClick={onClick} />);
      fireEvent.click(screen.getByRole('button'));
      expect(onClick).not.toHaveBeenCalled();
    });
  });

  describe('Footer status text', () => {
    it('shows urgentes text with status-error styling when urgent_count > 0', () => {
      render(
        <PipelineCard
          stage={makeStage({ count: 5, urgent_count: 2, late_count: 1 })}
          isSelected={false}
          onClick={vi.fn()}
        />,
      );
      const footer = screen.getByTestId('stage-footer');
      expect(footer).toHaveTextContent('3 urgentes');
      expect(footer.className).toContain('text-status-error');
    });

    it('shows urgentes text when only late_count > 0', () => {
      render(
        <PipelineCard
          stage={makeStage({ count: 5, late_count: 3 })}
          isSelected={false}
          onClick={vi.fn()}
        />,
      );
      const footer = screen.getByTestId('stage-footer');
      expect(footer).toHaveTextContent('3 urgentes');
    });

    it('shows alertas text with status-warning styling when only alert_count > 0', () => {
      render(
        <PipelineCard
          stage={makeStage({ count: 5, alert_count: 2 })}
          isSelected={false}
          onClick={vi.fn()}
        />,
      );
      const footer = screen.getByTestId('stage-footer');
      expect(footer).toHaveTextContent('2 alertas');
      expect(footer.className).toContain('text-status-warning');
    });

    it('shows OK with status-success styling when no issues', () => {
      render(
        <PipelineCard
          stage={makeStage({ count: 5 })}
          isSelected={false}
          onClick={vi.fn()}
        />,
      );
      const footer = screen.getByTestId('stage-footer');
      expect(footer).toHaveTextContent('OK');
      expect(footer.className).toContain('text-status-success');
    });

    it('shows no footer text when count is 0', () => {
      render(
        <PipelineCard stage={makeStage({ count: 0 })} isSelected={false} onClick={vi.fn()} />
      );
      const footer = screen.getByTestId('stage-footer');
      expect(footer).toHaveTextContent('—');
    });
  });

  describe('Selected state', () => {
    it('has accent border styling when selected', () => {
      render(
        <PipelineCard stage={makeStage({ count: 5 })} isSelected={true} onClick={vi.fn()} />,
      );
      const button = screen.getByRole('button');
      expect(button.className).toContain('border-accent');
    });

    it('does not have accent border styling when not selected', () => {
      render(
        <PipelineCard stage={makeStage({ count: 5 })} isSelected={false} onClick={vi.fn()} />,
      );
      const button = screen.getByRole('button');
      expect(button.className).not.toContain('border-accent');
    });
  });

  describe('Icon rendering', () => {
    it('renders an icon element for the stage', () => {
      render(<PipelineCard stage={makeStage()} isSelected={false} onClick={vi.fn()} />);
      expect(screen.getByTestId('stage-icon')).toBeTruthy();
    });
  });

  describe('Progress bar', () => {
    it('renders a progress bar with error color when urgent', () => {
      render(
        <PipelineCard
          stage={makeStage({ count: 3, urgent_count: 1 })}
          isSelected={false}
          onClick={vi.fn()}
        />,
      );
      const bar = screen.getByTestId('stage-progress');
      expect(bar.className).toContain('bg-[var(--color-status-error)]');
    });

    it('renders a progress bar with warning color when alert', () => {
      render(
        <PipelineCard
          stage={makeStage({ count: 3, alert_count: 1 })}
          isSelected={false}
          onClick={vi.fn()}
        />,
      );
      const bar = screen.getByTestId('stage-progress');
      expect(bar.className).toContain('bg-[var(--color-status-warning)]');
    });

    it('renders a progress bar with success color when ok', () => {
      render(
        <PipelineCard
          stage={makeStage({ count: 3 })}
          isSelected={false}
          onClick={vi.fn()}
        />,
      );
      const bar = screen.getByTestId('stage-progress');
      expect(bar.className).toContain('bg-[var(--color-status-success)]');
    });

    it('renders a progress bar with border color when empty', () => {
      render(
        <PipelineCard stage={makeStage({ count: 0 })} isSelected={false} onClick={vi.fn()} />,
      );
      const bar = screen.getByTestId('stage-progress');
      expect(bar.className).toContain('bg-border');
    });
  });

  describe('Design token styling', () => {
    it('uses bg-surface and border-border base classes', () => {
      render(
        <PipelineCard stage={makeStage({ count: 5 })} isSelected={false} onClick={vi.fn()} />,
      );
      const button = screen.getByRole('button');
      expect(button.className).toContain('bg-surface');
      expect(button.className).toContain('border-border');
    });

    it('uses text-text-muted for stage label', () => {
      render(<PipelineCard stage={makeStage()} isSelected={false} onClick={vi.fn()} />);
      const label = screen.getByText('Ingresado');
      expect(label.className).toContain('text-text-muted');
      expect(label.className).toContain('uppercase');
    });

    it('uses font-mono text-lg for count', () => {
      render(<PipelineCard stage={makeStage({ count: 5 })} isSelected={false} onClick={vi.fn()} />);
      const count = screen.getByTestId('stage-count');
      expect(count.className).toContain('font-mono');
      expect(count.className).toContain('text-lg');
    });
  });
});
