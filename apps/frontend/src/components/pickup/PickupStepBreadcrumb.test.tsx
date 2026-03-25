import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PickupStepBreadcrumb } from './PickupStepBreadcrumb';

describe('PickupStepBreadcrumb', () => {
  it('renders all five step labels in Spanish', () => {
    render(<PickupStepBreadcrumb current="scan" />);
    expect(screen.getByText('Recogida')).toBeInTheDocument();
    expect(screen.getByText('Escaneo')).toBeInTheDocument();
    expect(screen.getByText('Revisión')).toBeInTheDocument();
    expect(screen.getByText('Entrega')).toBeInTheDocument();
    expect(screen.getByText('Firma')).toBeInTheDocument();
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
    render(<PickupStepBreadcrumb current="handoff" />);
    const el = screen.getByText('Entrega');
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
