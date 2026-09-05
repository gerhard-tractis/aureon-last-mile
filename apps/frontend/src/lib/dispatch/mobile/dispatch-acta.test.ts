import { describe, it, expect } from 'vitest';
import { buildActaFigures, dockLeftLine, nextLoadLine } from './dispatch-acta';

describe('buildActaFigures — item 16, the 4 real figures', () => {
  it('reports stops, packages dispatched, packages left at dock, and split orders', () => {
    const figures = buildActaFigures({
      stopsCount: 24,
      packagesDispatched: 148,
      packagesLeftAtDock: 24,
      splitOrdersCount: 2,
    });
    expect(figures).toHaveLength(4);
    expect(figures.map((f) => f.value)).toEqual([24, 148, 24, 2]);
  });
});

describe('dockLeftLine — item 16, "lo que queda en el andén"', () => {
  it('names the real count and that the boxes go back to sectorizado, never asignado (H3 fix)', () => {
    const line = dockLeftLine(24, 2);
    expect(line).toMatch(/24/);
    expect(line).toMatch(/sectorizado/);
    expect(line).not.toMatch(/asignado\b/);
    expect(line).toMatch(/2/);
  });

  it('says nothing was left behind when the count is zero, never a false "0 paquetes"', () => {
    const line = dockLeftLine(0, 0);
    expect(line).toMatch(/no quedaron/i);
  });
});

describe('nextLoadLine — item 17, offers a concrete next load or nothing', () => {
  it('formats the real next route — code and comuna', () => {
    expect(nextLoadLine({ id: 'r-90', code: 'RUT-2026-0090', comuna: 'Maipú' })).toBe('RUT-2026-0090 · Maipú');
  });

  it('formats without a comuna if the route has none', () => {
    expect(nextLoadLine({ id: 'r-90', code: 'RUT-2026-0090', comuna: null })).toBe('RUT-2026-0090');
  });

  it('returns null when there is no next load — never invents one', () => {
    expect(nextLoadLine(null)).toBeNull();
  });
});
