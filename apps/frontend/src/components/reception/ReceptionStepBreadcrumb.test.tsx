import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReceptionStepBreadcrumb } from './ReceptionStepBreadcrumb';

describe('ReceptionStepBreadcrumb', () => {
  it('renders all step labels', () => {
    render(<ReceptionStepBreadcrumb current="reception" />);
    expect(screen.getByText('Recepción')).toBeInTheDocument();
    expect(screen.getByText('Escaneo')).toBeInTheDocument();
    expect(screen.getByText('Confirmación')).toBeInTheDocument();
  });

  it('highlights current step with aria-current', () => {
    render(<ReceptionStepBreadcrumb current="scan" />);
    expect(screen.getByText('Escaneo')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Recepción')).not.toHaveAttribute('aria-current');
  });

  it('marks previous steps as secondary text', () => {
    render(<ReceptionStepBreadcrumb current="confirm" />);
    expect(screen.getByText('Recepción').className).toContain('text-text-secondary');
    expect(screen.getByText('Escaneo').className).toContain('text-text-secondary');
    expect(screen.getByText('Confirmación').className).toContain('text-accent');
  });
});
