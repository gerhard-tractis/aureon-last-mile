import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs } from '@/components/ui/tabs';
import { DispatchModuleHeader } from './DispatchModuleHeader';

// DispatchModuleHeader renders TabsList/TabsTrigger only — it relies on a
// <Tabs> ancestor for Radix context (C1: one Tabs root shared with
// page.tsx's TabsContent panels, not two independent roots). The test wraps
// it here, which is honest about that dependency.
function renderHeader(props: Partial<React.ComponentProps<typeof DispatchModuleHeader>> = {}, tab = 'pre-ruta') {
  const onTabChange = vi.fn();
  const utils = render(
    <Tabs value={tab} onValueChange={onTabChange}>
      <DispatchModuleHeader
        unrouted={204}
        enCargaCount={5}
        enRutaCount={12}
        onNewRoute={vi.fn()}
        {...props}
      />
    </Tabs>,
  );
  return { ...utils, onTabChange };
}

describe('DispatchModuleHeader', () => {
  it('does not render its own breadcrumb nav — TopBar already owns it', () => {
    renderHeader();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('renders all 4 tabs in order with their labels', () => {
    renderHeader();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    expect(tabs[0]).toHaveTextContent('Pre-ruta');
    expect(tabs[1]).toHaveTextContent('En carga');
    expect(tabs[2]).toHaveTextContent('En ruta');
    expect(tabs[3]).toHaveTextContent('Completadas');
  });

  it('shows counts next to each tab label as part of its accessible name, wired to real data', () => {
    renderHeader();
    expect(screen.getByRole('tab', { name: 'Pre-ruta 204' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'En carga 5' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'En ruta 12' })).toBeInTheDocument();
  });

  it('renders Completadas without a count', () => {
    renderHeader();
    expect(screen.getByRole('tab', { name: 'Completadas' })).toBeInTheDocument();
  });

  it('omits a tab count when the source data is undefined rather than inventing one', () => {
    renderHeader({ enCargaCount: undefined });
    expect(screen.getByRole('tab', { name: 'En carga' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /En carga \d/ })).not.toBeInTheDocument();
  });

  it('marks the active tab from the ambient Tabs value', () => {
    renderHeader({}, 'in_progress');
    expect(screen.getByRole('tab', { name: /En ruta/ })).toHaveAttribute('data-state', 'active');
    expect(screen.getByRole('tab', { name: /Pre-ruta/ })).toHaveAttribute('data-state', 'inactive');
  });

  it('calls the ambient Tabs onValueChange when a tab is clicked', async () => {
    const user = userEvent.setup();
    const { onTabChange } = renderHeader();
    await user.click(screen.getByRole('tab', { name: /Completadas/ }));
    expect(onTabChange).toHaveBeenCalledWith('completed');
  });

  it('shows the SIN RUTEAR counter in monospace — a spec requirement, not incidental styling', () => {
    renderHeader({ unrouted: 204 });
    const counter = screen.getByText(/SIN RUTEAR/);
    expect(counter).toHaveTextContent('204');
    expect(counter).toHaveClass('font-mono');
  });

  it('calls onNewRoute when the new route button is clicked', () => {
    const onNewRoute = vi.fn();
    renderHeader({ onNewRoute });
    fireEvent.click(screen.getByRole('button', { name: /Nueva ruta/ }));
    expect(onNewRoute).toHaveBeenCalled();
  });

  it('shows no filtered qualifier by default (I4)', () => {
    renderHeader();
    expect(screen.queryByTestId('unrouted-filtered-qualifier')).toBeNull();
  });

  it('qualifies SIN RUTEAR as filtered when hasActiveFilters is true, without changing the count itself', () => {
    renderHeader({ unrouted: 204, hasActiveFilters: true });
    expect(screen.getByTestId('unrouted-filtered-qualifier')).toHaveTextContent('(filtrado)');
    expect(screen.getByText(/SIN RUTEAR/)).toHaveTextContent('204');
  });
});
