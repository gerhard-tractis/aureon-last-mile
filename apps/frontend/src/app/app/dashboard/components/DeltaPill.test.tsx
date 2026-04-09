import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DeltaPill } from './DeltaPill';

describe('DeltaPill', () => {
  it('positive value renders ▲ with formatted number and green color class', () => {
    render(<DeltaPill value={1.4} />);
    const el = screen.getByText(/▲/);
    expect(el).toBeInTheDocument();
    expect(el.textContent).toContain('1,4');
    expect(el.className).toMatch(/text-green/);
  });

  it('negative value renders ▼ with formatted number and red color class', () => {
    render(<DeltaPill value={-2.1} />);
    const el = screen.getByText(/▼/);
    expect(el).toBeInTheDocument();
    expect(el.textContent).toContain('2,1');
    expect(el.className).toMatch(/text-red/);
  });

  it('zero value renders 0,0 with neutral (non-green/non-red) styling', () => {
    render(<DeltaPill value={0} />);
    const el = screen.getByText('0,0');
    expect(el).toBeInTheDocument();
    expect(el.className).not.toMatch(/text-green/);
    expect(el.className).not.toMatch(/text-red/);
  });

  it('null value renders — with aria-label containing "no disponible"', () => {
    render(<DeltaPill value={null} />);
    const el = screen.getByText('—');
    expect(el).toBeInTheDocument();
    expect(el.getAttribute('aria-label')).toMatch(/no disponible/i);
  });

  it('null value uses custom aria-label when provided', () => {
    render(<DeltaPill value={null} aria-label="Delta personalizado" />);
    const el = screen.getByText('—');
    expect(el.getAttribute('aria-label')).toBe('Delta personalizado');
  });

  it('renders optional label text after the delta', () => {
    render(<DeltaPill value={3.5} label="vs mes anterior" />);
    expect(screen.getByText('vs mes anterior')).toBeInTheDocument();
  });
});
