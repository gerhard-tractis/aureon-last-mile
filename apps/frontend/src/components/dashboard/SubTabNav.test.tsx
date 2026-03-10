import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SubTabNav from './SubTabNav';

const TABS = [
  { id: 'tab_a', label: 'Tab A', enabled: true },
  { id: 'tab_b', label: 'Tab B', enabled: true },
  { id: 'tab_c', label: 'Tab C', enabled: false },
];

describe('SubTabNav', () => {
  it('renders all tab labels', () => {
    render(<SubTabNav tabs={TABS} activeTab="tab_a" onTabChange={() => {}} />);
    // Each label appears in both mobile option and desktop button
    expect(screen.getAllByText('Tab A').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Tab B').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Tab C/).length).toBeGreaterThan(0);
  });

  it('highlights the active tab', () => {
    render(<SubTabNav tabs={TABS} activeTab="tab_a" onTabChange={() => {}} />);
    const activeBtn = screen.getByRole('tab', { name: 'Tab A' });
    expect(activeBtn.getAttribute('aria-selected')).toBe('true');
  });

  it('calls onTabChange when clicking an enabled tab', () => {
    const onChange = vi.fn();
    render(<SubTabNav tabs={TABS} activeTab="tab_a" onTabChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Tab B' }));
    expect(onChange).toHaveBeenCalledWith('tab_b');
  });

  it('does not call onTabChange when clicking a disabled tab', () => {
    const onChange = vi.fn();
    render(<SubTabNav tabs={TABS} activeTab="tab_a" onTabChange={onChange} />);
    const disabledBtn = screen.getByRole('tab', { name: /Tab C/ });
    fireEvent.click(disabledBtn);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders mobile dropdown', () => {
    render(<SubTabNav tabs={TABS} activeTab="tab_a" onTabChange={() => {}} />);
    const select = screen.getByRole('combobox');
    expect(select).toBeDefined();
  });
});
