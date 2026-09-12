import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DockFilterPills } from './DockFilterPills';

describe('DockFilterPills', () => {
  it('marks "Todas" active when value is "all"', () => {
    render(<DockFilterPills value="all" onChange={vi.fn()} />);
    expect(screen.getByTestId('dock-filter-all').dataset.active).toBe('true');
    expect(screen.getByTestId('dock-filter-open').dataset.active).toBe('false');
  });

  it('marks "Lotes abiertos" active when value is "open"', () => {
    render(<DockFilterPills value="open" onChange={vi.fn()} />);
    expect(screen.getByTestId('dock-filter-open').dataset.active).toBe('true');
    expect(screen.getByTestId('dock-filter-all').dataset.active).toBe('false');
  });

  it('calls onChange("open") when "Lotes abiertos" is clicked', () => {
    const onChange = vi.fn();
    render(<DockFilterPills value="all" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('dock-filter-open'));
    expect(onChange).toHaveBeenCalledWith('open');
  });

  it('calls onChange("all") when "Todas" is clicked', () => {
    const onChange = vi.fn();
    render(<DockFilterPills value="open" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('dock-filter-all'));
    expect(onChange).toHaveBeenCalledWith('all');
  });
});
