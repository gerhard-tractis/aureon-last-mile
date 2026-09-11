import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ClientFilter } from './ClientFilter';

describe('ClientFilter', () => {
  // spec-95 fase 8 (mock 5a:88-95) — chips carry a count per client and a
  // "Todos · N" total, plus the CLIENTE label ahead of the row.
  const clients = [
    { name: 'Paris', count: 2 },
    { name: 'Easy', count: 3 },
  ];

  it('renders Todos pill always, with the sum of every chip', () => {
    render(<ClientFilter clients={clients} selected={null} onSelect={vi.fn()} />);
    expect(screen.getByText('Todos · 5')).toBeInTheDocument();
  });

  it('renders a pill per client with its own count', () => {
    render(<ClientFilter clients={clients} selected={null} onSelect={vi.fn()} />);
    expect(screen.getByText('Paris · 2')).toBeInTheDocument();
    expect(screen.getByText('Easy · 3')).toBeInTheDocument();
  });

  it('labels the row CLIENTE (styled uppercase), ahead of the pills', () => {
    render(<ClientFilter clients={clients} selected={null} onSelect={vi.fn()} />);
    const label = screen.getByText('Cliente');
    expect(label.className).toContain('uppercase');
  });

  it('calls onSelect(null) when Todos clicked', () => {
    const onSelect = vi.fn();
    render(<ClientFilter clients={clients} selected="Paris" onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Todos · 5'));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('calls onSelect with retailer name when pill clicked', () => {
    const onSelect = vi.fn();
    render(<ClientFilter clients={clients} selected={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Paris · 2'));
    expect(onSelect).toHaveBeenCalledWith('Paris');
  });

  it('highlights the selected pill', () => {
    render(<ClientFilter clients={clients} selected="Easy" onSelect={vi.fn()} />);
    const easyBtn = screen.getByText('Easy · 3');
    expect(easyBtn.className).toContain('bg-accent');
  });

  it('highlights Todos when selected is null', () => {
    render(<ClientFilter clients={clients} selected={null} onSelect={vi.fn()} />);
    const todosBtn = screen.getByText('Todos · 5');
    expect(todosBtn.className).toContain('bg-accent');
  });

  it('renders nothing extra when clients list is empty', () => {
    render(<ClientFilter clients={[]} selected={null} onSelect={vi.fn()} />);
    expect(screen.queryByText('Paris · 2')).not.toBeInTheDocument();
    expect(screen.getByText('Todos · 0')).toBeInTheDocument();
  });
});
