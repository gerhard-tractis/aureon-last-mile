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
});
