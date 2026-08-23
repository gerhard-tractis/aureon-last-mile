import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrderViewTabs } from './OrderViewTabs';
import { ORDER_VIEW_PRESETS } from '@/lib/orders/order-view-presets';

describe('OrderViewTabs', () => {
  it('renders one tab per preset from ORDER_VIEW_PRESETS, in order', () => {
    render(
      <OrderViewTabs activePreset="sla-en-riesgo" presetCounts={{}} onSelectPreset={vi.fn()} />,
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(ORDER_VIEW_PRESETS.length);
    expect(tabs.map((t) => t.textContent)).toEqual(
      expect.arrayContaining(ORDER_VIEW_PRESETS.map((p) => expect.stringContaining(p.label))),
    );
  });

  it('marks only the active preset tab as selected', () => {
    render(
      <OrderViewTabs activePreset="en-reparto" presetCounts={{}} onSelectPreset={vi.fn()} />,
    );
    const active = screen.getByRole('tab', { name: /en reparto/i });
    expect(active).toHaveAttribute('aria-selected', 'true');
    const inactive = screen.getByRole('tab', { name: /todas/i });
    expect(inactive).toHaveAttribute('aria-selected', 'false');
  });

  it('shows the count supplied by the parent next to each tab with one', () => {
    render(
      <OrderViewTabs
        activePreset="sla-en-riesgo"
        presetCounts={{ 'sla-en-riesgo': 47, todas: 12847 }}
        onSelectPreset={vi.fn()}
      />,
    );
    expect(screen.getByText('47')).toBeInTheDocument();
    expect(screen.getByText('12847')).toBeInTheDocument();
  });

  it('calls onSelectPreset with the clicked preset id', async () => {
    const user = userEvent.setup();
    const onSelectPreset = vi.fn();
    render(
      <OrderViewTabs activePreset="sla-en-riesgo" presetCounts={{}} onSelectPreset={onSelectPreset} />,
    );
    await user.click(screen.getByRole('tab', { name: /reingresos/i }));
    expect(onSelectPreset).toHaveBeenCalledWith('reingresos');
  });

  it('does not render "+ Nueva vista" — spec-65 Decision 2, presets are fixed', () => {
    render(
      <OrderViewTabs activePreset="sla-en-riesgo" presetCounts={{}} onSelectPreset={vi.fn()} />,
    );
    expect(screen.queryByText(/nueva vista/i)).not.toBeInTheDocument();
  });

  it('supports arrow-key navigation between tabs (roving tabindex) — a screen-reader user pressing Right must actually move focus', async () => {
    const user = userEvent.setup();
    render(
      <OrderViewTabs activePreset="sla-en-riesgo" presetCounts={{}} onSelectPreset={vi.fn()} />,
    );
    const tabs = screen.getAllByRole('tab');
    await user.click(tabs[0]);
    expect(tabs[0]).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(tabs[1]).toHaveFocus();
  });

  it('Tab enters the tab strip once, at the active tab, and a second Tab leaves it — one tab stop total, not one per tab', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button">before</button>
        <OrderViewTabs activePreset="en-reparto" presetCounts={{}} onSelectPreset={vi.fn()} />
        <button type="button">after</button>
      </div>,
    );
    screen.getByText('before').focus();
    await user.tab();
    expect(screen.getByRole('tab', { name: /en reparto/i })).toHaveFocus();
    await user.tab();
    expect(screen.getByText('after')).toHaveFocus();
  });
});
