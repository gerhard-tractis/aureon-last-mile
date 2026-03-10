import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PipelineNav from './PipelineNav';

describe('PipelineNav', () => {
  const defaultProps = {
    activeTab: 'loading' as const,
    onTabChange: vi.fn(),
  };

  it('renders Operaciones section label', () => {
    render(<PipelineNav {...defaultProps} />);
    expect(screen.getAllByText(/Operaciones/).length).toBeGreaterThan(0);
  });

  it('renders Analítica section label', () => {
    render(<PipelineNav {...defaultProps} />);
    expect(screen.getAllByText(/Analítica/).length).toBeGreaterThan(0);
  });

  it('renders OTIF tab under Analítica', () => {
    render(<PipelineNav {...defaultProps} activeTab="analytics_otif" />);
    expect(screen.getAllByText(/OTIF/).length).toBeGreaterThan(0);
  });

  it('renders Unit Economics and CX tabs', () => {
    render(<PipelineNav {...defaultProps} />);
    expect(screen.getAllByText(/Unit Economics/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/CX/).length).toBeGreaterThan(0);
  });

  it('renders all Operaciones tab labels', () => {
    render(<PipelineNav {...defaultProps} />);
    expect(screen.getAllByText(/Carga/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Última Milla/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Retiro/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Recepción/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Distribución/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Despacho/).length).toBeGreaterThan(0);
  });

  it('active tab has gold border class', () => {
    render(<PipelineNav {...defaultProps} activeTab="loading" />);
    const loadingTab = screen.getByRole('tab', { name: /Carga/ });
    expect(loadingTab.className).toContain('border-[#e6c15c]');
  });

  it('clicking an enabled tab calls onTabChange with correct tab id', async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(<PipelineNav activeTab="loading" onTabChange={onTabChange} />);
    await user.click(screen.getByRole('tab', { name: /Última Milla/ }));
    expect(onTabChange).toHaveBeenCalledWith('lastmile');
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
