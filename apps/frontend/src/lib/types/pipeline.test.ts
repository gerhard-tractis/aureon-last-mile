import { describe, it, expect } from 'vitest';
import {
  PIPELINE_STAGES, TERMINAL_PACKAGE_STATUSES, PRIORITY_CONFIG,
  type PackageStatus, type OrderStatus, type OrderPriority,
} from './pipeline';

describe('pipeline types and constants', () => {
  it('PIPELINE_STAGES has exactly 8 active stages in order', () => {
    expect(PIPELINE_STAGES).toHaveLength(8);
    expect(PIPELINE_STAGES[0].status).toBe('ingresado');
    expect(PIPELINE_STAGES[7].status).toBe('entregado');
  });

  it('PIPELINE_STAGES positions are sequential 1-8', () => {
    PIPELINE_STAGES.forEach((stage, i) => {
      expect(stage.position).toBe(i + 1);
    });
  });

  it('TERMINAL_PACKAGE_STATUSES contains exactly 4 terminal statuses', () => {
    expect(TERMINAL_PACKAGE_STATUSES).toHaveLength(4);
    expect(TERMINAL_PACKAGE_STATUSES).toContain('cancelado');
    expect(TERMINAL_PACKAGE_STATUSES).toContain('devuelto');
    expect(TERMINAL_PACKAGE_STATUSES).toContain('dañado');
    expect(TERMINAL_PACKAGE_STATUSES).toContain('extraviado');
  });

  it('PRIORITY_CONFIG covers all four priority levels', () => {
    const keys = Object.keys(PRIORITY_CONFIG) as OrderPriority[];
    expect(keys).toHaveLength(4);
    expect(keys).toContain('urgent');
    expect(keys).toContain('alert');
    expect(keys).toContain('ok');
    expect(keys).toContain('late');
  });

  it('each PRIORITY_CONFIG entry has label, color, and dotColor', () => {
    Object.values(PRIORITY_CONFIG).forEach((config) => {
      expect(config).toHaveProperty('label');
      expect(config).toHaveProperty('color');
      expect(config).toHaveProperty('dotColor');
      expect(config.dotColor).toMatch(/^bg-/);
    });
  });
});
