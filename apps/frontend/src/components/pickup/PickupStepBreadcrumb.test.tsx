import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PickupStepBreadcrumb } from './PickupStepBreadcrumb';

describe('PickupStepBreadcrumb', () => {
  it('renders the four real step labels in Spanish', () => {
    render(<PickupStepBreadcrumb current="scan" />);
    expect(screen.getByText('Recogida')).toBeInTheDocument();
    expect(screen.getByText('Escaneo')).toBeInTheDocument();
    expect(screen.getByText('Revisión')).toBeInTheDocument();
    expect(screen.getByText('Firma')).toBeInTheDocument();
  });

  // spec-80 fase 0: the Entrega screen was deleted by spec-47. Advertising a
  // step the crew cannot reach is what made the missing Firma look intentional.
  it('does not advertise Entrega, which no longer exists', () => {
    render(<PickupStepBreadcrumb current="review" />);
    expect(screen.queryByText('Entrega')).not.toBeInTheDocument();
  });

  it('marks current step with aria-current="step"', () => {
    render(<PickupStepBreadcrumb current="review" />);
    expect(screen.getByText('Revisión').closest('[aria-current="step"]')).toBeInTheDocument();
  });

  it('does not mark non-current steps as current', () => {
    render(<PickupStepBreadcrumb current="review" />);
    expect(screen.getByText('Escaneo').closest('[aria-current]')).toBeNull();
  });

  it('applies accent style to current step', () => {
    render(<PickupStepBreadcrumb current="complete" />);
    const el = screen.getByText('Firma');
    expect(el.className).toMatch(/text-accent/);
    expect(el.className).toMatch(/font-semibold/);
  });

  it('applies muted style to future steps', () => {
    render(<PickupStepBreadcrumb current="scan" />);
    const el = screen.getByText('Revisión');
    expect(el.className).toMatch(/text-text-muted/);
  });

  it('applies secondary style to completed steps', () => {
    render(<PickupStepBreadcrumb current="review" />);
    const el = screen.getByText('Escaneo');
    expect(el.className).toMatch(/text-text-secondary/);
  });
});
