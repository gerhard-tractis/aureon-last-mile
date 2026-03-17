/**
 * Tests for MobileTabBar component
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileTabBar } from './MobileTabBar';

describe('MobileTabBar', () => {
  describe('Rendering', () => {
    it('renders all 5 tabs', () => {
      render(
        <MobileTabBar activeTab="ops" onTabChange={vi.fn()} urgentCount={0} />,
      );
      expect(screen.getByTestId('tab-ops')).toBeTruthy();
      expect(screen.getByTestId('tab-dashboard')).toBeTruthy();
      expect(screen.getByTestId('tab-orders')).toBeTruthy();
      expect(screen.getByTestId('tab-reports')).toBeTruthy();
      expect(screen.getByTestId('tab-mas')).toBeTruthy();
    });

    it('renders tab labels', () => {
      render(
        <MobileTabBar activeTab="ops" onTabChange={vi.fn()} urgentCount={0} />,
      );
      expect(screen.getByText('Ops')).toBeTruthy();
      expect(screen.getByText('Dashboard')).toBeTruthy();
      expect(screen.getByText('Pedidos')).toBeTruthy();
      expect(screen.getByText('Reportes')).toBeTruthy();
      expect(screen.getByText('Más')).toBeTruthy();
    });
  });

  describe('Active tab styling', () => {
    it('active tab has aria-pressed=true', () => {
      render(
        <MobileTabBar activeTab="dashboard" onTabChange={vi.fn()} urgentCount={0} />,
      );
      const dashboardTab = screen.getByTestId('tab-dashboard');
      expect(dashboardTab.getAttribute('aria-pressed')).toBe('true');
    });

    it('inactive tab has aria-pressed=false', () => {
      render(
        <MobileTabBar activeTab="dashboard" onTabChange={vi.fn()} urgentCount={0} />,
      );
      const opsTab = screen.getByTestId('tab-ops');
      expect(opsTab.getAttribute('aria-pressed')).toBe('false');
    });

    it('active tab has data-active attribute', () => {
      render(
        <MobileTabBar activeTab="orders" onTabChange={vi.fn()} urgentCount={0} />,
      );
      const ordersTab = screen.getByTestId('tab-orders');
      expect(ordersTab.getAttribute('data-active')).toBe('true');
    });
  });

  describe('Tab interactions', () => {
    it('calls onTabChange with "ops" when ops tab clicked', () => {
      const onTabChange = vi.fn();
      render(
        <MobileTabBar activeTab="dashboard" onTabChange={onTabChange} urgentCount={0} />,
      );
      fireEvent.click(screen.getByTestId('tab-ops'));
      expect(onTabChange).toHaveBeenCalledWith('ops');
    });

    it('calls onTabChange with "dashboard" when dashboard tab clicked', () => {
      const onTabChange = vi.fn();
      render(
        <MobileTabBar activeTab="ops" onTabChange={onTabChange} urgentCount={0} />,
      );
      fireEvent.click(screen.getByTestId('tab-dashboard'));
      expect(onTabChange).toHaveBeenCalledWith('dashboard');
    });

    it('calls onTabChange with "orders" when orders tab clicked', () => {
      const onTabChange = vi.fn();
      render(
        <MobileTabBar activeTab="ops" onTabChange={onTabChange} urgentCount={0} />,
      );
      fireEvent.click(screen.getByTestId('tab-orders'));
      expect(onTabChange).toHaveBeenCalledWith('orders');
    });

    it('calls onTabChange with "reports" when reports tab clicked', () => {
      const onTabChange = vi.fn();
      render(
        <MobileTabBar activeTab="ops" onTabChange={onTabChange} urgentCount={0} />,
      );
      fireEvent.click(screen.getByTestId('tab-reports'));
      expect(onTabChange).toHaveBeenCalledWith('reports');
    });

    it('calls onTabChange with "mas" when más tab clicked', () => {
      const onTabChange = vi.fn();
      render(
        <MobileTabBar activeTab="ops" onTabChange={onTabChange} urgentCount={0} />,
      );
      fireEvent.click(screen.getByTestId('tab-mas'));
      expect(onTabChange).toHaveBeenCalledWith('mas');
    });
  });

  describe('Urgent badge on ops tab', () => {
    it('shows urgentCount badge when count > 0', () => {
      render(
        <MobileTabBar activeTab="ops" onTabChange={vi.fn()} urgentCount={5} />,
      );
      expect(screen.getByTestId('ops-badge')).toBeTruthy();
      expect(screen.getByTestId('ops-badge')).toHaveTextContent('5');
    });

    it('shows "99+" when urgentCount > 99', () => {
      render(
        <MobileTabBar activeTab="ops" onTabChange={vi.fn()} urgentCount={150} />,
      );
      expect(screen.getByTestId('ops-badge')).toHaveTextContent('99+');
    });

    it('hides badge when urgentCount is 0', () => {
      render(
        <MobileTabBar activeTab="ops" onTabChange={vi.fn()} urgentCount={0} />,
      );
      expect(screen.queryByTestId('ops-badge')).toBeNull();
    });

    it('shows exact 99 count (not 99+)', () => {
      render(
        <MobileTabBar activeTab="ops" onTabChange={vi.fn()} urgentCount={99} />,
      );
      expect(screen.getByTestId('ops-badge')).toHaveTextContent('99');
    });
  });
});
