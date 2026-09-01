import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VehicleCapacityBar } from './VehicleCapacityBar';
import { getVehicleFillStatus } from '@/lib/dispatch/vehicle-capacity';

describe('VehicleCapacityBar', () => {
  describe('unconfigured — must render nothing', () => {
    it('renders nothing at all when capacity is not configured (null)', () => {
      const status = getVehicleFillStatus(50, null);
      const { container } = render(<VehicleCapacityBar status={status} />);
      expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when capacity is 0', () => {
      const status = getVehicleFillStatus(0, 0);
      const { container } = render(<VehicleCapacityBar status={status} />);
      expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when capacity is negative', () => {
      const status = getVehicleFillStatus(5, -10);
      const { container } = render(<VehicleCapacityBar status={status} />);
      expect(container).toBeEmptyDOMElement();
    });

    it('does not render a "0%" number, a dash, or a tooltip when unconfigured', () => {
      const status = getVehicleFillStatus(0, null);
      render(<VehicleCapacityBar status={status} />);
      expect(screen.queryByText(/0%/)).not.toBeInTheDocument();
      expect(screen.queryByText('—')).not.toBeInTheDocument();
      expect(screen.queryByTestId('vehicle-capacity-fill')).not.toBeInTheDocument();
    });
  });

  describe('configured — renders the bar and correct tone', () => {
    it('renders count/capacity text when configured', () => {
      const status = getVehicleFillStatus(25, 40);
      render(<VehicleCapacityBar status={status} />);
      expect(screen.getByText('25 / 40')).toBeInTheDocument();
    });

    it('applies the warning fill token below 50% fill (under-filled, inverted from the dock)', () => {
      const status = getVehicleFillStatus(10, 100);
      render(<VehicleCapacityBar status={status} />);
      const bar = screen.getByTestId('vehicle-capacity-fill');
      expect(bar.className).toContain('bg-status-warning');
    });

    it('applies the warning fill token at exactly 49%', () => {
      const status = getVehicleFillStatus(49, 100);
      render(<VehicleCapacityBar status={status} />);
      expect(screen.getByTestId('vehicle-capacity-fill').className).toContain('bg-status-warning');
    });

    it('applies the neutral fill token at exactly 50% (the healthy band starts here, not at 90 like the dock)', () => {
      const status = getVehicleFillStatus(50, 100);
      render(<VehicleCapacityBar status={status} />);
      const bar = screen.getByTestId('vehicle-capacity-fill');
      expect(bar.className).toContain('bg-text-secondary');
      expect(bar.className).not.toContain('bg-status-warning');
    });

    it('applies the neutral fill token at 99%', () => {
      const status = getVehicleFillStatus(99, 100);
      render(<VehicleCapacityBar status={status} />);
      expect(screen.getByTestId('vehicle-capacity-fill').className).toContain('bg-text-secondary');
    });

    it('applies the error fill token at exactly 100% (exactly full)', () => {
      const status = getVehicleFillStatus(100, 100);
      render(<VehicleCapacityBar status={status} />);
      const bar = screen.getByTestId('vehicle-capacity-fill');
      expect(bar.className).toContain('bg-status-error');
    });

    it('never uses raw hex colours', () => {
      const status = getVehicleFillStatus(80, 100);
      const { container } = render(<VehicleCapacityBar status={status} />);
      expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    });
  });

  describe('accessibility — progressbar role and values', () => {
    it('exposes role=progressbar with count-based aria values', () => {
      const status = getVehicleFillStatus(25, 40);
      render(<VehicleCapacityBar status={status} />);
      const bar = screen.getByRole('progressbar');
      expect(bar).toHaveAttribute('aria-valuenow', '25');
      expect(bar).toHaveAttribute('aria-valuemin', '0');
      expect(bar).toHaveAttribute('aria-valuemax', '40');
    });
  });

  describe('warning tone is not colour-only', () => {
    it('shows a text marker (not just an amber fill) when under-filled', () => {
      const status = getVehicleFillStatus(10, 100);
      render(<VehicleCapacityBar status={status} />);
      expect(screen.getByTestId('vehicle-capacity-underfilled')).toBeInTheDocument();
    });

    it('does not show the under-filled marker in the healthy or over-capacity bands', () => {
      const healthy = getVehicleFillStatus(80, 100);
      const { unmount } = render(<VehicleCapacityBar status={healthy} />);
      expect(screen.queryByTestId('vehicle-capacity-underfilled')).not.toBeInTheDocument();
      unmount();

      const over = getVehicleFillStatus(140, 100);
      render(<VehicleCapacityBar status={over} />);
      expect(screen.queryByTestId('vehicle-capacity-underfilled')).not.toBeInTheDocument();
    });
  });

  describe('over-capacity must be visibly distinct from exactly-full', () => {
    it('shows the overcapacity marker only when over 100%, not at exactly 100%', () => {
      const exactlyFull = getVehicleFillStatus(100, 100);
      const { unmount } = render(<VehicleCapacityBar status={exactlyFull} />);
      expect(screen.queryByTestId('vehicle-capacity-overcapacity')).not.toBeInTheDocument();
      unmount();

      const overCapacity = getVehicleFillStatus(140, 100);
      render(<VehicleCapacityBar status={overCapacity} />);
      expect(screen.getByTestId('vehicle-capacity-overcapacity')).toBeInTheDocument();
    });

    it('over-capacity carries a distinct ring class the exactly-full bar does not have', () => {
      const exactlyFull = getVehicleFillStatus(100, 100);
      const { container: fullContainer, unmount } = render(<VehicleCapacityBar status={exactlyFull} />);
      const fullTrack = fullContainer.querySelector('[data-testid="vehicle-capacity-fill"]')!.parentElement!;
      expect(fullTrack.className).not.toContain('ring-status-error');
      unmount();

      const overCapacity = getVehicleFillStatus(140, 100);
      const { container: overContainer } = render(<VehicleCapacityBar status={overCapacity} />);
      const overTrack = overContainer.querySelector('[data-testid="vehicle-capacity-fill"]')!.parentElement!;
      expect(overTrack.className).toContain('ring-status-error');
    });

    it('shows the true over-100 percentage in the overcapacity label, not clamped', () => {
      const overCapacity = getVehicleFillStatus(140, 100);
      render(<VehicleCapacityBar status={overCapacity} />);
      expect(screen.getByTestId('vehicle-capacity-overcapacity')).toHaveTextContent('140%');
    });

    it('still clamps the visual bar width at 100% for layout even though the label shows the true percentage', () => {
      const overCapacity = getVehicleFillStatus(140, 100);
      render(<VehicleCapacityBar status={overCapacity} />);
      const bar = screen.getByTestId('vehicle-capacity-fill');
      expect(bar.style.width).toBe('100%');
    });
  });

  describe('mutation-proving the UI-layer guarantee', () => {
    it('MUTATION GUARD: an unconfigured status must not render a fill element at all', () => {
      const status = getVehicleFillStatus(0, null);
      const { container } = render(<VehicleCapacityBar status={status} />);
      // A mutant that falls through to rendering a 0%-wide bar for the
      // unconfigured branch (e.g. treating `status.configured` as always
      // truthy, or defaulting capacity to 0 and rendering anyway) is
      // caught here: the container must be fully empty, not merely
      // "has no visible width".
      expect(container).toBeEmptyDOMElement();
      expect(container.querySelector('[data-testid="vehicle-capacity-fill"]')).toBeNull();
    });
  });
});
