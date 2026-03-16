/**
 * Tests for UrgentOrdersBanner component
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UrgentOrdersBanner } from './UrgentOrdersBanner';

describe('UrgentOrdersBanner', () => {
  describe('Null render', () => {
    it('returns null when both counts are 0', () => {
      const { container } = render(
        <UrgentOrdersBanner urgentCount={0} lateCount={0} onViewUrgent={vi.fn()} />,
      );
      expect(container.firstChild).toBeNull();
    });
  });

  describe('Visible with urgentCount > 0', () => {
    it('shows banner text with correct total when urgentCount > 0', () => {
      render(
        <UrgentOrdersBanner urgentCount={3} lateCount={0} onViewUrgent={vi.fn()} />,
      );
      expect(screen.getByTestId('urgent-banner')).toHaveTextContent(
        '3 pedidos requieren atención inmediata',
      );
    });

    it('shows banner text with correct total when lateCount > 0', () => {
      render(
        <UrgentOrdersBanner urgentCount={0} lateCount={5} onViewUrgent={vi.fn()} />,
      );
      expect(screen.getByTestId('urgent-banner')).toHaveTextContent(
        '5 pedidos requieren atención inmediata',
      );
    });

    it('shows correct total when both counts are > 0', () => {
      render(
        <UrgentOrdersBanner urgentCount={2} lateCount={3} onViewUrgent={vi.fn()} />,
      );
      expect(screen.getByTestId('urgent-banner')).toHaveTextContent(
        '5 pedidos requieren atención inmediata',
      );
    });
  });

  describe('"Ver urgentes" button', () => {
    it('calls onViewUrgent when "Ver urgentes" is clicked', () => {
      const onViewUrgent = vi.fn();
      render(
        <UrgentOrdersBanner urgentCount={2} lateCount={0} onViewUrgent={onViewUrgent} />,
      );
      fireEvent.click(screen.getByText('Ver urgentes'));
      expect(onViewUrgent).toHaveBeenCalledOnce();
    });
  });

  describe('Dismiss behavior', () => {
    it('dismiss button hides the banner', () => {
      render(
        <UrgentOrdersBanner urgentCount={2} lateCount={0} onViewUrgent={vi.fn()} />,
      );
      expect(screen.getByTestId('urgent-banner')).toBeTruthy();
      const dismissBtn = screen.getByTestId('urgent-banner-dismiss');
      fireEvent.click(dismissBtn);
      expect(screen.queryByTestId('urgent-banner')).toBeNull();
    });

    it('banner re-appears when counts change from 0 to > 0 after dismissal', () => {
      const { rerender } = render(
        <UrgentOrdersBanner urgentCount={2} lateCount={0} onViewUrgent={vi.fn()} />,
      );
      // Dismiss
      fireEvent.click(screen.getByTestId('urgent-banner-dismiss'));
      expect(screen.queryByTestId('urgent-banner')).toBeNull();

      // Counts go to 0
      rerender(
        <UrgentOrdersBanner urgentCount={0} lateCount={0} onViewUrgent={vi.fn()} />,
      );
      expect(screen.queryByTestId('urgent-banner')).toBeNull();

      // New counts arrive > 0
      rerender(
        <UrgentOrdersBanner urgentCount={4} lateCount={1} onViewUrgent={vi.fn()} />,
      );
      expect(screen.getByTestId('urgent-banner')).toBeTruthy();
      expect(screen.getByTestId('urgent-banner')).toHaveTextContent(
        '5 pedidos requieren atención inmediata',
      );
    });
  });
});
