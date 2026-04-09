import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NorthStarCard } from './NorthStarCard';

// DeltaPill is tested separately; we test NorthStarCard in integration with it.

describe('NorthStarCard', () => {
  it('live mode with value renders formatted value + MoM delta + YoY delta', () => {
    render(
      <NorthStarCard
        mode="live"
        label="OTIF"
        value={94.2}
        formatter={(v) => (v !== null ? `${v}%` : '—')}
        momDelta={1.4}
        yoyDelta={-2.1}
      />,
    );
    expect(screen.getByText('OTIF')).toBeInTheDocument();
    expect(screen.getByText('94.2%')).toBeInTheDocument();
    // DeltaPill renders ▲ 1,4 and ▼ 2,1
    expect(screen.getByText(/▲/)).toBeInTheDocument();
    expect(screen.getByText(/▼/)).toBeInTheDocument();
  });

  it('live mode with yoyDelta=null renders — with aria-label "YoY no disponible · menos de 12 meses de datos"', () => {
    render(
      <NorthStarCard
        mode="live"
        label="OTIF"
        value={94.2}
        formatter={(v) => (v !== null ? `${v}%` : '—')}
        momDelta={1.4}
        yoyDelta={null}
      />,
    );
    const yoyEl = screen.getByLabelText(
      'YoY no disponible · menos de 12 meses de datos',
    );
    expect(yoyEl).toBeInTheDocument();
    expect(yoyEl.textContent).toBe('—');
  });

  it('placeholder mode renders — as value, Próximamente pill, and placeholderHint', () => {
    render(
      <NorthStarCard
        mode="placeholder"
        label="CPO"
        placeholderHint="Requiere modelo de costos"
      />,
    );
    expect(screen.getByText('CPO')).toBeInTheDocument();
    // Hero value is —
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Próximamente')).toBeInTheDocument();
    expect(screen.getByText('Requiere modelo de costos')).toBeInTheDocument();
  });

  it('live mode with value=null renders — as hero value', () => {
    render(
      <NorthStarCard
        mode="live"
        label="Órdenes"
        value={null}
        momDelta={null}
        yoyDelta={null}
      />,
    );
    // hero — (at least one)
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('label is always rendered', () => {
    render(<NorthStarCard mode="placeholder" label="NPS · CSAT" />);
    expect(screen.getByText('NPS · CSAT')).toBeInTheDocument();
  });
});
