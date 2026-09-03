import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MultiSelectFilter } from './MultiSelectFilter';

const OPTIONS = [
  { id: 'a', name: 'Andén Norte' },
  { id: 'b', name: 'Andén Sur' },
];

describe('MultiSelectFilter', () => {
  const onChange = vi.fn();

  beforeEach(() => {
    onChange.mockClear();
  });

  it('shows the placeholder label when nothing is selected', () => {
    render(<MultiSelectFilter label="Andén" options={OPTIONS} selected={[]} onChange={onChange} />);
    expect(screen.getByRole('button', { name: /andén/i })).toBeInTheDocument();
  });

  it('shows a count badge when options are selected', () => {
    render(<MultiSelectFilter label="Andén" options={OPTIONS} selected={['a']} onChange={onChange} />);
    expect(screen.getByRole('button', { name: /andén/i })).toHaveTextContent('1');
  });

  it('opens the option list on click and lists every option', () => {
    render(<MultiSelectFilter label="Andén" options={OPTIONS} selected={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /andén/i }));
    expect(screen.getByText('Andén Norte')).toBeInTheDocument();
    expect(screen.getByText('Andén Sur')).toBeInTheDocument();
  });

  it('adds an id to the selection when an unselected option is clicked', () => {
    render(<MultiSelectFilter label="Andén" options={OPTIONS} selected={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /andén/i }));
    fireEvent.click(screen.getByText('Andén Norte'));
    expect(onChange).toHaveBeenCalledWith(['a']);
  });

  it('removes an id from the selection when a selected option is clicked again', () => {
    render(<MultiSelectFilter label="Andén" options={OPTIONS} selected={['a']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /andén/i }));
    fireEvent.click(screen.getByText('Andén Norte'));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('renders an empty state when there are no options', () => {
    render(<MultiSelectFilter label="Cliente" options={[]} selected={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /cliente/i }));
    expect(screen.getByText(/sin resultados/i)).toBeInTheDocument();
  });

  it('never renders a nested checkbox control inside the popover (C1 regression)', () => {
    // Code-review C1: a role="checkbox" (Radix's real, tabbable button)
    // nested inside a CommandItem is a dead, unreachable-by-Tab control and
    // an axe nested-interactive/aria-hidden-focus violation. The selection
    // glyph must stay a plain, non-interactive icon.
    render(<MultiSelectFilter label="Andén" options={OPTIONS} selected={['a']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /andén/i }));
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('marks the selected option with aria-checked on the option itself', () => {
    render(<MultiSelectFilter label="Andén" options={OPTIONS} selected={['a']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /andén/i }));
    expect(screen.getByText('Andén Norte').closest('[cmdk-item]')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Andén Sur').closest('[cmdk-item]')).toHaveAttribute('aria-checked', 'false');
  });

  it('disambiguates two options that share a display name (M12 regression)', () => {
    const dupes = [
      { id: 'c1', name: 'Maipú' },
      { id: 'c2', name: 'Maipú' },
    ];
    render(<MultiSelectFilter label="Comuna" options={dupes} selected={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /comuna/i }));
    const items = screen.getAllByText('Maipú');
    expect(items).toHaveLength(2);
    fireEvent.click(items[1]);
    expect(onChange).toHaveBeenCalledWith(['c2']);
  });
});
