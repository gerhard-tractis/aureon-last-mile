import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReceptionSummary } from './ReceptionSummary';

describe('ReceptionSummary', () => {
  it('renders MetricCards with correct values via data-value', () => {
    const { container } = render(
      <ReceptionSummary expectedCount={10} receivedCount={8} />
    );
    const valueEls = container.querySelectorAll('[data-value]');
    expect(valueEls).toHaveLength(3);
    expect(valueEls[0].textContent).toBe('10');
    expect(valueEls[1].textContent).toBe('8');
    expect(valueEls[2].textContent).toBe('2');
  });

  it('renders Spanish labels', () => {
    render(<ReceptionSummary expectedCount={10} receivedCount={10} />);
    expect(screen.getByText('Esperados')).toBeInTheDocument();
    expect(screen.getByText('Recibidos')).toBeInTheDocument();
    expect(screen.getByText('Faltantes')).toBeInTheDocument();
  });

  it('shows green status banner when all received', () => {
    render(<ReceptionSummary expectedCount={10} receivedCount={10} />);
    expect(screen.getByText('Todos los paquetes recibidos')).toBeInTheDocument();
  });

  it('shows amber status banner when discrepancies', () => {
    render(<ReceptionSummary expectedCount={10} receivedCount={8} />);
    expect(screen.getByText(/paquetes faltantes/)).toBeInTheDocument();
  });

  it('handles zero expected gracefully', () => {
    const { container } = render(
      <ReceptionSummary expectedCount={0} receivedCount={0} />
    );
    const valueEls = container.querySelectorAll('[data-value]');
    expect(valueEls).toHaveLength(3);
    valueEls.forEach((el) => expect(el.textContent).toBe('0'));
  });
});
