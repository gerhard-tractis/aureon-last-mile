import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ModuleKey } from '@/lib/modules/registry';

let mockPathname = '/app/pickup';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

import { MobileTabBar } from './MobileTabBar';

const ALL_MODULES = [ModuleKey.PICKUP, ModuleKey.RECEPTION, ModuleKey.DISTRIBUTION, ModuleKey.DISPATCH];

describe('MobileTabBar', () => {
  beforeEach(() => {
    mockPathname = '/app/pickup';
  });

  it('renders nothing for a role the tab bar does not serve', () => {
    const { container } = render(
      <MobileTabBar ctx={{ role: 'operations_manager', permissions: [], enabledModules: ALL_MODULES }} />,
    );
    expect(container.querySelector('nav')).toBeNull();
  });

  it('renders a labelled nav with the four operations tabs, as real links', () => {
    render(
      <MobileTabBar
        ctx={{
          role: 'pickup_crew',
          permissions: ['pickup', 'reception', 'distribution', 'dispatch'],
          enabledModules: ALL_MODULES,
        }}
      />,
    );
    const nav = screen.getByRole('navigation', { name: /navegación principal/i });
    expect(nav).toBeTruthy();

    for (const [label, href] of [
      ['Recogida', '/app/pickup'],
      ['Recepción', '/app/reception'],
      ['Distribución', '/app/distribution'],
      ['Despacho', '/app/dispatch'],
    ]) {
      const link = screen.getByRole('link', { name: label });
      expect(link.getAttribute('href')).toBe(href);
    }
  });

  it('only shows the tabs backed by the driver’s actual permissions', () => {
    render(
      <MobileTabBar ctx={{ role: 'pickup_crew', permissions: ['pickup'], enabledModules: ALL_MODULES }} />,
    );
    expect(screen.getByRole('link', { name: 'Recogida' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Recepción' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Distribución' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Despacho' })).toBeNull();
  });

  it('does not render a tab whose module is disabled for the operator', () => {
    render(
      <MobileTabBar
        ctx={{
          role: 'warehouse_staff',
          permissions: ['reception', 'distribution'],
          enabledModules: [ModuleKey.RECEPTION],
        }}
      />,
    );
    expect(screen.getByRole('link', { name: 'Recepción' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Distribución' })).toBeNull();
  });

  it('marks the tab matching the current route active with aria-current, not colour alone', () => {
    mockPathname = '/app/reception/some-detail';
    render(
      <MobileTabBar
        ctx={{
          role: 'warehouse_staff',
          permissions: ['reception', 'distribution'],
          enabledModules: ALL_MODULES,
        }}
      />,
    );
    const active = screen.getByRole('link', { name: 'Recepción' });
    const inactive = screen.getByRole('link', { name: 'Distribución' });
    expect(active.getAttribute('aria-current')).toBe('page');
    expect(inactive.getAttribute('aria-current')).toBeNull();
    // Non-colour signal: the active tab carries a distinct font-weight class.
    expect(active.className).toMatch(/font-semibold/);
    expect(inactive.className).not.toMatch(/font-semibold/);
  });

  it('gives every tab a touch target at least 44px tall', () => {
    render(
      <MobileTabBar
        ctx={{ role: 'pickup_crew', permissions: ['pickup'], enabledModules: ALL_MODULES }}
      />,
    );
    const link = screen.getByRole('link', { name: 'Recogida' });
    expect(link.className).toMatch(/min-h-\[44px\]/);
  });

  it('floors bottom padding at 22px and reads the iOS safe-area inset', () => {
    render(
      <MobileTabBar
        ctx={{ role: 'pickup_crew', permissions: ['pickup'], enabledModules: ALL_MODULES }}
      />,
    );
    const link = screen.getByRole('link', { name: 'Recogida' });
    expect(link.className).toMatch(/pb-\[max\(22px,env\(safe-area-inset-bottom\)\)\]/);
  });

  it('is hidden at the lg breakpoint via CSS, not JS viewport detection', () => {
    render(
      <MobileTabBar
        ctx={{ role: 'pickup_crew', permissions: ['pickup'], enabledModules: ALL_MODULES }}
      />,
    );
    const nav = screen.getByRole('navigation', { name: /navegación principal/i });
    expect(nav.className).toMatch(/lg:hidden/);
  });

  it('renders nothing on a screen that already owns a fixed bottom action bar', () => {
    mockPathname = '/app/pickup/scan/LOAD-1';
    const { container } = render(
      <MobileTabBar
        ctx={{ role: 'pickup_crew', permissions: ['pickup'], enabledModules: ALL_MODULES }}
      />,
    );
    expect(container.querySelector('nav')).toBeNull();
  });
});
