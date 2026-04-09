import { describe, it, expect } from 'vitest';
import {
  CHAPTER_LABELS,
  NORTH_STAR_LABELS,
  TACTICAL_LABELS,
  DRILL_LABELS,
  PERIOD_PRESET_LABELS,
  PLACEHOLDER_COPY,
} from './labels.es';

// ---------------------------------------------------------------------------
// CHAPTER_LABELS
// ---------------------------------------------------------------------------
describe('CHAPTER_LABELS', () => {
  it('has CPO chapter title', () => {
    expect(CHAPTER_LABELS.cpo).toBe('CPO');
  });

  it('has OTIF chapter title', () => {
    expect(CHAPTER_LABELS.otif).toBe('OTIF');
  });

  it('has NPS/CSAT chapter title', () => {
    expect(CHAPTER_LABELS.nps).toBe('NPS / CSAT');
  });

  it('has CPO annotation', () => {
    expect(CHAPTER_LABELS.cpoAnnotation).toBe('CAPÍTULO 01');
  });

  it('has OTIF annotation', () => {
    expect(CHAPTER_LABELS.otifAnnotation).toBe('CAPÍTULO 02');
  });

  it('has NPS annotation', () => {
    expect(CHAPTER_LABELS.npsAnnotation).toBe('CAPÍTULO 03');
  });
});

// ---------------------------------------------------------------------------
// NORTH_STAR_LABELS
// ---------------------------------------------------------------------------
describe('NORTH_STAR_LABELS', () => {
  it('has orders label', () => {
    expect(NORTH_STAR_LABELS.orders).toBe('Órdenes');
  });

  it('has OTIF label', () => {
    expect(NORTH_STAR_LABELS.otif).toBe('OTIF');
  });

  it('has CPO label', () => {
    expect(NORTH_STAR_LABELS.cpo).toBe('CPO');
  });

  it('has NPS label with middle dot', () => {
    expect(NORTH_STAR_LABELS.nps).toBe('NPS · CSAT');
  });
});

// ---------------------------------------------------------------------------
// TACTICAL_LABELS
// ---------------------------------------------------------------------------
describe('TACTICAL_LABELS', () => {
  it('has FADR label containing FADR', () => {
    expect(TACTICAL_LABELS.fadr).toContain('FADR');
  });

  it('has avgKmPerRoute label containing km (case insensitive)', () => {
    expect(TACTICAL_LABELS.avgKmPerRoute.toLowerCase()).toContain('km');
  });

  it('has gas label (truthy)', () => {
    expect(TACTICAL_LABELS.gas).toBeTruthy();
  });

  it('has costPerKm label (truthy)', () => {
    expect(TACTICAL_LABELS.costPerKm).toBeTruthy();
  });

  it('has driversActive label (truthy)', () => {
    expect(TACTICAL_LABELS.driversActive).toBeTruthy();
  });

  it('has routesCompleted label (truthy)', () => {
    expect(TACTICAL_LABELS.routesCompleted).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// DRILL_LABELS
// ---------------------------------------------------------------------------
describe('DRILL_LABELS', () => {
  it('has late_reasons label in Spanish', () => {
    expect(DRILL_LABELS.late_reasons).toBeTruthy();
    expect(typeof DRILL_LABELS.late_reasons).toBe('string');
  });

  it('has region label in Spanish', () => {
    expect(DRILL_LABELS.region).toBeTruthy();
    expect(typeof DRILL_LABELS.region).toBe('string');
  });

  it('has customer label in Spanish', () => {
    expect(DRILL_LABELS.customer).toBeTruthy();
    expect(typeof DRILL_LABELS.customer).toBe('string');
  });

  it('has driver label (truthy)', () => {
    expect(DRILL_LABELS.driver).toBeTruthy();
  });

  it('has time_of_day label (truthy)', () => {
    expect(DRILL_LABELS.time_of_day).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// PERIOD_PRESET_LABELS
// ---------------------------------------------------------------------------
describe('PERIOD_PRESET_LABELS', () => {
  it('month → Mes', () => {
    expect(PERIOD_PRESET_LABELS.month).toBe('Mes');
  });

  it('quarter → Trimestre', () => {
    expect(PERIOD_PRESET_LABELS.quarter).toBe('Trimestre');
  });

  it('ytd → YTD', () => {
    expect(PERIOD_PRESET_LABELS.ytd).toBe('YTD');
  });

  it('custom → Personalizado', () => {
    expect(PERIOD_PRESET_LABELS.custom).toBe('Personalizado');
  });
});

// ---------------------------------------------------------------------------
// PLACEHOLDER_COPY
// ---------------------------------------------------------------------------
describe('PLACEHOLDER_COPY', () => {
  it('cpo placeholder mentions modelo de costos', () => {
    expect(PLACEHOLDER_COPY.cpo.toLowerCase()).toContain('modelo de costos');
  });

  it('nps placeholder mentions feedback', () => {
    expect(PLACEHOLDER_COPY.nps.toLowerCase()).toContain('feedback');
  });

  it('gas placeholder mentions combustible or consumo', () => {
    const lower = PLACEHOLDER_COPY.gas.toLowerCase();
    expect(lower.includes('combustible') || lower.includes('consumo')).toBe(true);
  });
});
