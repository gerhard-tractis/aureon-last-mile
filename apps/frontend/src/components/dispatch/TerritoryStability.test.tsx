import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TerritoryStability } from './TerritoryStability';
import type { TerritoryHistoryEntry } from '@/lib/dispatch/types';

function entry(overrides: Partial<TerritoryHistoryEntry> = {}): TerritoryHistoryEntry {
  return {
    comunaId: 'comuna-1',
    comunaName: 'Ñuñoa',
    driverName: 'Juan Pérez',
    runCount: 3,
    lastRouteDate: '2026-08-20',
    ...overrides,
  };
}

describe('TerritoryStability', () => {
  it('renders nothing when there is no territory history and no orphans', () => {
    const { container } = render(
      <TerritoryStability territory={[]} driverName="" orphanCount={0} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders no warning when the field is still empty (no divergence claim)', () => {
    render(<TerritoryStability territory={[entry()]} driverName="" orphanCount={0} />);
    expect(screen.queryByText(/Cambiando de conductor/)).not.toBeInTheDocument();
  });

  it('renders no warning when the typed driver matches the suggestion', () => {
    render(
      <TerritoryStability territory={[entry({ driverName: 'Juan Pérez' })]} driverName="Juan Pérez" orphanCount={0} />,
    );
    expect(screen.queryByText(/Cambiando de conductor/)).not.toBeInTheDocument();
  });

  it('warns, naming the comuna, the usual driver and the run count, when the typed driver diverges', () => {
    render(
      <TerritoryStability
        territory={[entry({ comunaName: 'Ñuñoa', driverName: 'Juan Pérez', runCount: 3 })]}
        driverName="Otro Conductor"
        orphanCount={0}
      />,
    );
    const warning = screen.getByText(/Cambiando de conductor/);
    expect(warning.textContent).toContain('Ñuñoa');
    expect(warning.textContent).toContain('Juan Pérez');
    expect(warning.textContent).toContain('3 veces');
  });

  it('uses singular "vez" for a run_count of 1', () => {
    render(
      <TerritoryStability
        territory={[entry({ runCount: 1 })]}
        driverName="Otro Conductor"
        orphanCount={0}
      />,
    );
    expect(screen.getByText(/1 vez en total/)).toBeInTheDocument();
  });

  // Review item 3 (HIGH): run_count is an unweighted ALL-TIME count (see
  // the migration's own header) — the copy must not claim a recency the
  // data doesn't support.
  it('never claims "recientemente" — run_count has no time window', () => {
    render(
      <TerritoryStability
        territory={[entry({ runCount: 40 })]}
        driverName="Otro Conductor"
        orphanCount={0}
      />,
    );
    expect(screen.queryByText(/recientemente/)).not.toBeInTheDocument();
    expect(screen.getByText(/40 veces en total/)).toBeInTheDocument();
  });

  it('warns once per diverging comuna, ignoring comunas that already match', () => {
    render(
      <TerritoryStability
        territory={[
          entry({ comunaId: 'c-1', comunaName: 'Ñuñoa', driverName: 'Juan Pérez' }),
          entry({ comunaId: 'c-2', comunaName: 'Providencia', driverName: 'Ana Soto' }),
        ]}
        driverName="Ana Soto"
        orphanCount={0}
      />,
    );
    expect(screen.getByText(/Ñuñoa/)).toBeInTheDocument();
    expect(screen.queryByText(/Providencia/)).not.toBeInTheDocument();
  });

  it('surfaces the orphan caveat whenever orphanCount is greater than zero', () => {
    render(<TerritoryStability territory={[]} driverName="" orphanCount={2} />);
    expect(screen.getByText(/2 paradas aún sin secuencia asignada/)).toBeInTheDocument();
  });

  it('uses singular phrasing for a single orphan', () => {
    render(<TerritoryStability territory={[]} driverName="" orphanCount={1} />);
    expect(screen.getByText(/1 parada aún sin secuencia asignada/)).toBeInTheDocument();
  });

  it('shows both a divergence warning and the orphan caveat together', () => {
    render(
      <TerritoryStability
        territory={[entry({ driverName: 'Juan Pérez' })]}
        driverName="Otro Conductor"
        orphanCount={1}
      />,
    );
    expect(screen.getByText(/Cambiando de conductor/)).toBeInTheDocument();
    expect(screen.getByText(/1 parada aún sin secuencia asignada/)).toBeInTheDocument();
  });

  // Review item 4 (HIGH): orphanCount === null means the blocks read
  // itself failed — the orphan count is UNKNOWN, not zero, and that must
  // never render as a silent, complete-looking "no caveat at all".
  describe('when the orphan count could not be determined (orphanCount === null)', () => {
    it('renders an explicit incompleteness caveat instead of nothing', () => {
      render(<TerritoryStability territory={[]} driverName="" orphanCount={null} />);
      expect(screen.getByText(/No se pudo verificar si faltan paradas/)).toBeInTheDocument();
    });

    it('never renders the "0 orphans" silence — no numeric orphan caveat at all', () => {
      render(<TerritoryStability territory={[]} driverName="" orphanCount={null} />);
      expect(screen.queryByText(/paradas aún sin secuencia asignada/)).not.toBeInTheDocument();
    });

    it('is distinguishable from a genuine orphanCount of 0 (which renders nothing)', () => {
      const zero = render(<TerritoryStability territory={[]} driverName="" orphanCount={0} />);
      expect(zero.container).toBeEmptyDOMElement();
      zero.unmount();

      const unknown = render(<TerritoryStability territory={[]} driverName="" orphanCount={null} />);
      expect(unknown.container).not.toBeEmptyDOMElement();
    });
  });

  describe('isDriverSuggested', () => {
    it('shows "sugerido por historial" when the value was auto-filled', () => {
      render(
        <TerritoryStability territory={[]} driverName="Juan Pérez" orphanCount={0} isDriverSuggested />,
      );
      expect(screen.getByText('sugerido por historial')).toBeInTheDocument();
    });

    it('does not show the suggested marker for a typed value', () => {
      render(<TerritoryStability territory={[]} driverName="Juan Pérez" orphanCount={0} />);
      expect(screen.queryByText('sugerido por historial')).not.toBeInTheDocument();
    });
  });
});
