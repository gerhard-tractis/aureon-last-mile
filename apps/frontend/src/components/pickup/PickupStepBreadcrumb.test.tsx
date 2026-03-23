import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PickupStepBreadcrumb } from './PickupStepBreadcrumb';

describe('PickupStepBreadcrumb', () => {
  it('renders all five step labels', () => {
    render(<PickupStepBreadcrumb current="scan" />);
    expect(screen.getByText('Pickup')).toBeInTheDocument();
    expect(screen.getByText('Scan')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
    expect(screen.getByText('Handoff')).toBeInTheDocument();
    expect(screen.getByText('Complete')).toBeInTheDocument();
  });

  it('marks current step with aria-current="step"', () => {
    render(<PickupStepBreadcrumb current="review" />);
    expect(screen.getByText('Review').closest('[aria-current="step"]')).toBeInTheDocument();
  });

  it('does not mark non-current steps as current', () => {
    render(<PickupStepBreadcrumb current="review" />);
    expect(screen.getByText('Scan').closest('[aria-current]')).toBeNull();
  });

  it('applies accent style to current step', () => {
    render(<PickupStepBreadcrumb current="handoff" />);
    const el = screen.getByText('Handoff');
    expect(el.className).toMatch(/text-accent/);
    expect(el.className).toMatch(/font-semibold/);
  });

  it('applies muted style to future steps', () => {
    render(<PickupStepBreadcrumb current="scan" />);
    const el = screen.getByText('Review');
    expect(el.className).toMatch(/text-text-muted/);
  });

  it('applies secondary style to completed steps', () => {
    render(<PickupStepBreadcrumb current="review" />);
    const el = screen.getByText('Scan');
    expect(el.className).toMatch(/text-text-secondary/);
  });
});
