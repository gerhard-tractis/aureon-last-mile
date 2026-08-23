import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WhyLateBlock } from './WhyLateBlock';

describe('WhyLateBlock — undeterminable cause renders nothing', () => {
  it('renders nothing when stage is unknown', () => {
    const { container } = render(
      <WhyLateBlock stage={null} reasonFlag="no_driver" stuckSinceISO="2026-08-13T09:00:00" now={new Date()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when reasonFlag is unknown', () => {
    const { container } = render(
      <WhyLateBlock stage="delivery" reasonFlag={null} stuckSinceISO="2026-08-13T09:00:00" now={new Date()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when reasonFlag does not match any known REASON_LABELS key', () => {
    const { container } = render(
      <WhyLateBlock
        stage="delivery"
        reasonFlag="some_made_up_reason"
        stuckSinceISO="2026-08-13T09:00:00"
        now={new Date()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when stuckSinceISO is absent', () => {
    const { container } = render(
      <WhyLateBlock stage="delivery" reasonFlag="no_driver" stuckSinceISO={null} now={new Date()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  // The rule this guards: "if the cause cannot be determined, render nothing —
  // not a placeholder, not a generic sentence." A component that rendered a
  // fallback string like "Causa desconocida" here would make this test fail,
  // which is the point: it is not enough for the block to merely be absent
  // when unmounted — it must produce no visible text under this exact input.
  it('produces no text content at all — a fallback sentence would fail this', () => {
    const { container } = render(
      <WhyLateBlock stage={null} reasonFlag={null} stuckSinceISO={null} now={new Date()} />,
    );
    expect(container.textContent).toBe('');
  });
});

describe('WhyLateBlock — determinable cause composes prose', () => {
  const now = new Date('2026-08-13T12:41:00');

  it('names the stage, the reason, and the time in that stage', () => {
    render(
      <WhyLateBlock stage="consolidation" reasonFlag="no_driver" stuckSinceISO="2026-08-13T09:29:00" now={now} />,
    );
    expect(screen.getByText(/Consolidación/)).toBeInTheDocument();
    expect(screen.getByText(/Sin conductor/)).toBeInTheDocument();
    expect(screen.getByText(/3h 12m/)).toBeInTheDocument();
  });

  it('renders no action button when no callback is supplied', () => {
    render(
      <WhyLateBlock stage="consolidation" reasonFlag="no_driver" stuckSinceISO="2026-08-13T09:29:00" now={now} />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders exactly one button per supplied callback, and calls it on click', async () => {
    const onRelease = vi.fn();
    const onReassign = vi.fn();
    render(
      <WhyLateBlock
        stage="consolidation"
        reasonFlag="no_driver"
        stuckSinceISO="2026-08-13T09:29:00"
        now={now}
        onReleaseFromConsolidation={onRelease}
        onReassignRoute={onReassign}
      />,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);

    await userEvent.click(screen.getByText('Liberar de consolidación'));
    expect(onRelease).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByText('Reasignar ruta'));
    expect(onReassign).toHaveBeenCalledTimes(1);

    expect(screen.queryByText('Avisar al cliente')).not.toBeInTheDocument();
  });

  it('renders the "notify client" button only when its callback is supplied', () => {
    const onNotify = vi.fn();
    render(
      <WhyLateBlock
        stage="delivery"
        reasonFlag="unassigned"
        stuckSinceISO="2026-08-13T09:29:00"
        now={now}
        onNotifyClient={onNotify}
      />,
    );
    expect(screen.getByText('Avisar al cliente')).toBeInTheDocument();
  });
});
