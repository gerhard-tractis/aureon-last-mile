import { describe, it, expect } from 'vitest';
import {
  PIPELINE_STAGES, TERMINAL_PACKAGE_STATUSES, PRIORITY_CONFIG,
  type PackageStatus, type OrderStatus, type OrderPriority,
} from './pipeline';

describe('pipeline types and constants', () => {
  it('PIPELINE_STAGES has exactly 10 active stages in order', () => {
    expect(PIPELINE_STAGES).toHaveLength(10);
    expect(PIPELINE_STAGES[0].status).toBe('ingresado');
    // Highest position is entregado (position 8)
    const sorted = [...PIPELINE_STAGES].sort((a, b) => a.position - b.position);
    expect(sorted[sorted.length - 1].status).toBe('entregado');
  });

  it('PIPELINE_STAGES positions are strictly increasing with min 1 and max 8', () => {
    const positions = PIPELINE_STAGES.map((s) => s.position);
    // Strictly increasing
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
    expect(Math.min(...positions)).toBe(1);
    expect(Math.max(...positions)).toBe(8);
  });

  it('TERMINAL_PACKAGE_STATUSES contains exactly 4 terminal statuses', () => {
    expect(TERMINAL_PACKAGE_STATUSES).toHaveLength(4);
    expect(TERMINAL_PACKAGE_STATUSES).toContain('cancelado');
    expect(TERMINAL_PACKAGE_STATUSES).toContain('devuelto');
    expect(TERMINAL_PACKAGE_STATUSES).toContain('dañado');
    expect(TERMINAL_PACKAGE_STATUSES).toContain('extraviado');
  });

  it('retorno_hub is a valid PackageStatus', () => {
    // TypeScript compile-time check — assignment would fail if not in the union
    const s: PackageStatus = 'retorno_hub';
    expect(s).toBe('retorno_hub');
  });

  it('retorno_hub is NOT in TERMINAL_PACKAGE_STATUSES', () => {
    expect(TERMINAL_PACKAGE_STATUSES).not.toContain('retorno_hub');
  });

  it('en_retorno and parcialmente_entregado are valid OrderStatus values', () => {
    // TypeScript compile-time check — assignments would fail if not in the union
    const s1: OrderStatus = 'en_retorno';
    const s2: OrderStatus = 'parcialmente_entregado';
    expect(s1).toBe('en_retorno');
    expect(s2).toBe('parcialmente_entregado');
  });

  it('PIPELINE_STAGES includes entries for en_retorno and parcialmente_entregado', () => {
    const statuses = PIPELINE_STAGES.map((s) => s.status);
    expect(statuses).toContain('en_retorno');
    expect(statuses).toContain('parcialmente_entregado');
  });

  it('parcialmente_entregado has position 7.4 and en_retorno has position 7.6', () => {
    const pe = PIPELINE_STAGES.find((s) => s.status === 'parcialmente_entregado');
    const er = PIPELINE_STAGES.find((s) => s.status === 'en_retorno');
    expect(pe?.position).toBe(7.4);
    expect(er?.position).toBe(7.6);
  });

  // ── spec-51: enum drift with the database ──────────────────────────────────
  // Migration 20260324000001_dispatch_module.sql renamed 'listo' to
  // 'listo_para_despacho' in BOTH order_status_enum and package_status_enum.
  // The prod drift gate (verify-prod-migrations) confirms that migration is
  // applied, so the database never emits 'listo'. Components look stages up by
  // exact string match — OrderLifecycleRibbon does
  // PIPELINE_STAGES.find(s => s.status === leadingStatus) — so a stale literal
  // silently renders no stage at all rather than failing loudly.

  it('PIPELINE_STAGES uses the current DB literal listo_para_despacho', () => {
    const statuses = PIPELINE_STAGES.map((s) => s.status);
    expect(statuses).toContain('listo_para_despacho');
  });

  it('PIPELINE_STAGES no longer carries the pre-rename literal listo', () => {
    const statuses = PIPELINE_STAGES.map((s) => s.status as string);
    expect(statuses).not.toContain('listo');
  });

  it('listo_para_despacho keeps position 6 in the pipeline', () => {
    const stage = PIPELINE_STAGES.find((s) => s.status === 'listo_para_despacho');
    expect(stage?.position).toBe(6);
  });

  it('listo_para_despacho is a valid OrderStatus and PackageStatus', () => {
    // Compile-time check — these assignments fail type-check if the union is stale
    const o: OrderStatus = 'listo_para_despacho';
    const p: PackageStatus = 'listo_para_despacho';
    expect(o).toBe('listo_para_despacho');
    expect(p).toBe('listo_para_despacho');
  });

  it('sectorizado and retenido are valid PackageStatus values', () => {
    // Both are in package_status_enum (20260319000001) and are produced by
    // trg_dock_scan_advance_package_status, but were missing from the union.
    const s1: PackageStatus = 'sectorizado';
    const s2: PackageStatus = 'retenido';
    expect(s1).toBe('sectorizado');
    expect(s2).toBe('retenido');
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
