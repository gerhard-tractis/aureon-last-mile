import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AndenCard } from './AndenCard';
import type { PreRouteAnden } from '@/lib/types';

function makeAnden(overrides: Partial<PreRouteAnden> = {}): PreRouteAnden {
  return {
    id: 'zone-1',
    name: 'Andén Norte',
    comunas_list: ['Santiago', 'Providencia'],
    order_count: 5,
    package_count: 8,
    comunas: [],
    order_ids: ['ord-1', 'ord-2', 'ord-3'],
    has_split_dock_zone_warnings: false,
    ...overrides,
  };
}

describe('AndenCard', () => {
  let onToggleSelect: ReturnType<typeof vi.fn>;
  let onToggleExpand: ReturnType<typeof vi.fn>;
  let onCreateRoute: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onToggleSelect = vi.fn();
    onToggleExpand = vi.fn();
    onCreateRoute = vi.fn();
  });

  function renderCard(overrides: Partial<PreRouteAnden> = {}, isSelected = false, isExpanded = false) {
    return render(
      <AndenCard
        anden={makeAnden(overrides)}
        isSelected={isSelected}
        isExpanded={isExpanded}
        onToggleSelect={onToggleSelect}
        onToggleExpand={onToggleExpand}
        onCreateRoute={onCreateRoute}
      />,
    );
  }

  it('renders the andén name', () => {
    renderCard();
    expect(screen.getByText('Andén Norte')).toBeInTheDocument();
  });

  it('renders order_count', () => {
    renderCard({ order_count: 7 });
    expect(screen.getByText(/7/)).toBeInTheDocument();
  });

  it('renders package_count', () => {
    renderCard({ package_count: 12 });
    expect(screen.getByText(/12/)).toBeInTheDocument();
  });

  it('renders comunas_list summary', () => {
    renderCard({ comunas_list: ['Santiago', 'Providencia'] });
    expect(screen.getByText(/Santiago/)).toBeInTheDocument();
  });

  it('checkbox is checked when isSelected=true', () => {
    renderCard({}, true);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeChecked();
  });

  it('checkbox fires onToggleSelect when changed', () => {
    renderCard();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggleSelect).toHaveBeenCalledTimes(1);
  });

  it('clicking checkbox does NOT fire onToggleExpand', () => {
    renderCard();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggleExpand).not.toHaveBeenCalled();
  });

  it('clicking body (expand button) fires onToggleExpand', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /Andén Norte/ }));
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
  });

  it('clicking body does NOT fire onToggleSelect', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /Andén Norte/ }));
    expect(onToggleSelect).not.toHaveBeenCalled();
  });

  it('Crear ruta button fires onCreateRoute with the andén order_ids', () => {
    renderCard({ order_ids: ['ord-a', 'ord-b'] });
    fireEvent.click(screen.getByRole('button', { name: /Crear ruta/ }));
    expect(onCreateRoute).toHaveBeenCalledWith(['ord-a', 'ord-b']);
    expect(onToggleSelect).not.toHaveBeenCalled();
    expect(onToggleExpand).not.toHaveBeenCalled();
  });

  it('shows ComunaBreakdown when isExpanded=true', () => {
    const anden = makeAnden({
      comunas: [
        { id: 'com-1', name: 'Santiago', order_count: 3, package_count: 4, orders: [] },
      ],
    });
    render(
      <AndenCard
        anden={anden}
        isSelected={false}
        isExpanded={true}
        onToggleSelect={onToggleSelect}
        onToggleExpand={onToggleExpand}
        onCreateRoute={onCreateRoute}
      />,
    );
    expect(screen.getByText('Santiago')).toBeInTheDocument();
  });

  it('hides ComunaBreakdown when isExpanded=false', () => {
    const anden = makeAnden({
      comunas: [
        { id: 'com-1', name: 'UniqueCommune', order_count: 1, package_count: 1, orders: [] },
      ],
    });
    render(
      <AndenCard
        anden={anden}
        isSelected={false}
        isExpanded={false}
        onToggleSelect={onToggleSelect}
        onToggleExpand={onToggleExpand}
        onCreateRoute={onCreateRoute}
      />,
    );
    expect(screen.queryByText('UniqueCommune')).not.toBeInTheDocument();
  });
});
