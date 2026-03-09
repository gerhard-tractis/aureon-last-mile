import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PipelineNav from './PipelineNav';

describe('PipelineNav', () => {
  const defaultProps = {
    activeTab: 'overview' as const,
    onTabChange: vi.fn(),
  };

  it('renders all tab labels', () => {
    render(<PipelineNav {...defaultProps} />);
    expect(screen.getAllByText(/Vista General/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Carga/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Entregas/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Retiro/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Recepción/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Distribución/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Despacho/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Última Milla/).length).toBeGreaterThan(0);
  });

  it('active tab has gold border class', () => {
    render(<PipelineNav {...defaultProps} activeTab="loading" />);
    const loadingTab = screen.getByRole('tab', { name: /Carga/ });
    expect(loadingTab.className).toContain('border-[#e6c15c]');
  });

  it('clicking an enabled tab calls onTabChange with correct tab id', async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(<PipelineNav activeTab="overview" onTabChange={onTabChange} />);
    await user.click(screen.getByRole('tab', { name: /Carga/ }));
    expect(onTabChange).toHaveBeenCalledWith('loading');
  });

  it('disabled tabs have disabled attribute', () => {
    render(<PipelineNav {...defaultProps} />);
    const pickupTab = screen.getByRole('tab', { name: /Retiro/ });
    expect(pickupTab).toBeDisabled();
    const receptionTab = screen.getByRole('tab', { name: /Recepción/ });
    expect(receptionTab).toBeDisabled();
  });

  it('mobile select element exists', () => {
    render(<PipelineNav {...defaultProps} />);
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
  });
});
