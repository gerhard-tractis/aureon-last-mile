import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ClientFilter } from './ClientFilter';

describe('ClientFilter', () => {
  const clients = ['Paris', 'Easy'];

  it('renders Todos pill always', () => {
    render(<ClientFilter clients={clients} selected={null} onSelect={vi.fn()} />);
    expect(screen.getByText('Todos')).toBeInTheDocument();
  });

  it('renders a pill per client', () => {
    render(<ClientFilter clients={clients} selected={null} onSelect={vi.fn()} />);
    expect(screen.getByText('Paris')).toBeInTheDocument();
    expect(screen.getByText('Easy')).toBeInTheDocument();
  });

  it('calls onSelect(null) when Todos clicked', () => {
    const onSelect = vi.fn();
    render(<ClientFilter clients={clients} selected="Paris" onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Todos'));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('calls onSelect with retailer name when pill clicked', () => {
    const onSelect = vi.fn();
    render(<ClientFilter clients={clients} selected={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Paris'));
    expect(onSelect).toHaveBeenCalledWith('Paris');
  });

  it('highlights the selected pill', () => {
    render(<ClientFilter clients={clients} selected="Easy" onSelect={vi.fn()} />);
    const easyBtn = screen.getByText('Easy');
    expect(easyBtn.className).toContain('bg-accent');
  });

  it('highlights Todos when selected is null', () => {
    render(<ClientFilter clients={clients} selected={null} onSelect={vi.fn()} />);
    const todosBtn = screen.getByText('Todos');
    expect(todosBtn.className).toContain('bg-accent');
  });

  it('renders nothing extra when clients list is empty', () => {
    render(<ClientFilter clients={[]} selected={null} onSelect={vi.fn()} />);
    expect(screen.queryByText('Paris')).not.toBeInTheDocument();
    expect(screen.getByText('Todos')).toBeInTheDocument();
  });
});
