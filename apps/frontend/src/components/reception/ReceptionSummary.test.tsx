import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReceptionSummary } from './ReceptionSummary';

describe('ReceptionSummary', () => {
  it('renders expected, received, and missing counts', () => {
    render(
      <ReceptionSummary expectedCount={10} receivedCount={8} />
    );
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows "Esperados" label', () => {
    render(
      <ReceptionSummary expectedCount={10} receivedCount={10} />
    );
    expect(screen.getByText('Esperados')).toBeInTheDocument();
  });

  it('shows "Recibidos" label', () => {
    render(
      <ReceptionSummary expectedCount={10} receivedCount={10} />
    );
    expect(screen.getByText('Recibidos')).toBeInTheDocument();
  });

  it('shows "Faltantes" label', () => {
    render(
      <ReceptionSummary expectedCount={10} receivedCount={8} />
    );
    expect(screen.getByText('Faltantes')).toBeInTheDocument();
  });

  it('shows green indicator when all packages received', () => {
    const { container } = render(
      <ReceptionSummary expectedCount={10} receivedCount={10} />
    );
    const successBanner = container.querySelector('[data-testid="summary-status"]');
    expect(successBanner).toBeInTheDocument();
    expect(successBanner?.textContent).toContain('Todos los paquetes recibidos');
  });

  it('shows amber indicator when there are discrepancies', () => {
    const { container } = render(
      <ReceptionSummary expectedCount={10} receivedCount={8} />
    );
    const warningBanner = container.querySelector('[data-testid="summary-status"]');
    expect(warningBanner).toBeInTheDocument();
    expect(warningBanner?.textContent).toContain('paquetes faltantes');
  });

  it('displays zero missing when counts match', () => {
    render(
      <ReceptionSummary expectedCount={5} receivedCount={5} />
    );
    // Missing count should be 0
    expect(screen.getByTestId('missing-count')).toHaveTextContent('0');
  });

  it('calculates correct missing count', () => {
    render(
      <ReceptionSummary expectedCount={20} receivedCount={15} />
    );
    expect(screen.getByTestId('missing-count')).toHaveTextContent('5');
  });

  it('handles zero expected gracefully', () => {
    render(
      <ReceptionSummary expectedCount={0} receivedCount={0} />
    );
    // All three counts display 0
    const zeros = screen.getAllByText('0');
    expect(zeros).toHaveLength(3);
  });
});
