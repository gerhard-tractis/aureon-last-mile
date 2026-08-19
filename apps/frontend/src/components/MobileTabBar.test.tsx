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

  it('still shows all four tabs on a partial permission set — the missing ones are disabled, not hidden', () => {
    render(
      <MobileTabBar ctx={{ role: 'pickup_crew', permissions: ['pickup'], enabledModules: ALL_MODULES }} />,
    );
    expect(screen.getByRole('link', { name: 'Recogida' })).toBeTruthy();
    // No permission for these three: present, but not links.
    expect(screen.queryByRole('link', { name: 'Recepción' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Distribución' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Despacho' })).toBeNull();
    expect(screen.getByText(/^Recepción/)).toBeTruthy();
    expect(screen.getByText(/^Distribución/)).toBeTruthy();
    expect(screen.getByText(/^Despacho/)).toBeTruthy();
  });

  it('renders a permission-missing tab as a non-focusable, aria-disabled element with a self-explaining label', () => {
    render(
      <MobileTabBar ctx={{ role: 'pickup_crew', permissions: ['pickup'], enabledModules: ALL_MODULES }} />,
    );
    const disabled = screen.getByText(/^Recepción/).closest('[aria-disabled]');
    expect(disabled).toBeTruthy();
    expect(disabled?.tagName).toBe('SPAN');
    expect(disabled?.getAttribute('href')).toBeNull();
    // Not tabbable: no tabIndex, and not an element the tab order includes.
    expect(disabled?.hasAttribute('tabindex')).toBe(false);
    expect(disabled?.tagName).not.toBe('A');
    // Muted token, no opacity stacked on top of it (compositing opacity
    // over the token dropped light-mode contrast to ~1.7:1 — unreadable).
    expect(disabled?.className).toMatch(/text-text-muted/);
    expect(disabled?.className).not.toMatch(/opacity-/);
    // Screen-reader-only explanation, not conveyed by appearance alone.
    expect(disabled?.textContent).toContain('sin acceso');
  });

  it('badges the disabled tab icon with a lock — the non-colour "no access" cue', () => {
    render(
      <MobileTabBar ctx={{ role: 'pickup_crew', permissions: ['pickup'], enabledModules: ALL_MODULES }} />,
    );
    const disabled = screen.getByText(/^Recepción/).closest('[aria-disabled]');
    expect(disabled?.querySelector('svg.lucide-lock')).toBeTruthy();
  });

  it('does not badge the enabled tab with a lock', () => {
    render(
      <MobileTabBar ctx={{ role: 'pickup_crew', permissions: ['pickup'], enabledModules: ALL_MODULES }} />,
    );
    const link = screen.getByRole('link', { name: 'Recogida' });
    expect(link.querySelector('svg.lucide-lock')).toBeNull();
  });

  it('keeps the enabled tab a real, routable, focusable link even when siblings are disabled', () => {
    render(
      <MobileTabBar ctx={{ role: 'pickup_crew', permissions: ['pickup'], enabledModules: ALL_MODULES }} />,
    );
    const link = screen.getByRole('link', { name: 'Recogida' });
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/app/pickup');
    expect(link.getAttribute('aria-disabled')).toBeNull();
  });

  it('renders a module-disabled tab as present-but-disabled, not absent', () => {
    render(
      <MobileTabBar
        ctx={{
          role: 'warehouse_staff',
          permissions: ['reception', 'distribution'],
          enabledModules: [ModuleKey.RECEPTION],
        }}
      />,
    );
    // Reception: permission + module both present — a live link.
    expect(screen.getByRole('link', { name: 'Recepción' })).toBeTruthy();
    // Distribución: permission held, but the module is off for this operator
    // — still rendered, as a disabled item, not omitted.
    expect(screen.queryByRole('link', { name: 'Distribución' })).toBeNull();
    const disabled = screen.getByText(/^Distribución/).closest('[aria-disabled]');
    expect(disabled).toBeTruthy();
    expect(disabled?.tagName).toBe('SPAN');
  });

  it('always renders exactly four tabs for an operations role, whatever the permission/module state', () => {
    render(
      <MobileTabBar
        ctx={{ role: 'pickup_crew', permissions: [], enabledModules: [] }}
      />,
    );
    const nav = screen.getByRole('navigation', { name: /navegación principal/i });
    expect(nav.querySelectorAll('a, span[aria-disabled]')).toHaveLength(4);
    expect(nav.querySelectorAll('a')).toHaveLength(0);
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
