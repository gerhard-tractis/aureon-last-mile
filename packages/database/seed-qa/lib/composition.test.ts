/**
 * The carga composition matrix is the whole point of the Musan fixture, so it
 * is a pure function with its own tests rather than a literal buried in the
 * scenario. What is asserted here is the SHAPE a tester is promised — box
 * counts, SKU cardinality, and the spec-55 parent/sibling distinction — not
 * that some rows exist.
 */

import { describe, it, expect } from 'vitest';
import {
  CARGA_COMPOSITION,
  COMPOSITION_LABELS,
  buildOrderPackages,
  buildCargaOrders,
  distinctSkus,
  toPackageRows,
} from './composition';

describe('CARGA_COMPOSITION', () => {
  it('is ten orders, two of each of the five shapes', () => {
    expect(CARGA_COMPOSITION).toHaveLength(10);

    const counts = new Map<string, number>();
    for (const key of CARGA_COMPOSITION) counts.set(key, (counts.get(key) ?? 0) + 1);

    expect([...counts.entries()].sort()).toEqual([
      ['mono', 2],
      ['multi_box_sku', 2],
      ['multi_box_sku_plus_mono', 2],
      ['repeated_sku_three_boxes', 2],
      ['three_distinct_skus', 2],
    ]);
  });

  it('gives every shape a human label for the order description', () => {
    for (const key of new Set(CARGA_COMPOSITION)) {
      expect(COMPOSITION_LABELS[key]).toBeTruthy();
    }
  });
});

describe('buildOrderPackages', () => {
  it('mono: one box carrying one SKU', () => {
    const pkgs = buildOrderPackages('mono');
    expect(pkgs).toHaveLength(1);
    expect(distinctSkus(pkgs)).toHaveLength(1);
    expect(pkgs[0]).toMatchObject({
      labelSuffix: 'CTN-1',
      declaredBoxCount: 1,
      packageNumber: '1 de 1',
      isGeneratedLabel: false,
      parentLabelSuffix: null,
    });
  });

  it('repeated_sku_three_boxes: three independently declared boxes of ONE sku', () => {
    const pkgs = buildOrderPackages('repeated_sku_three_boxes');
    expect(pkgs).toHaveLength(3);
    expect(distinctSkus(pkgs)).toHaveLength(1);

    // The distinction from multi_box_sku: each box is its own declared carton,
    // so nothing is a generated sibling and every box counts itself as 1 of 1.
    for (const p of pkgs) {
      expect(p.declaredBoxCount).toBe(1);
      expect(p.packageNumber).toBe('1 de 1');
      expect(p.isGeneratedLabel).toBe(false);
      expect(p.parentLabelSuffix).toBeNull();
      expect(p.skuItems).toHaveLength(1);
    }
    expect(pkgs.map((p) => p.labelSuffix)).toEqual(['CTN-1', 'CTN-2', 'CTN-3']);
  });

  it('three_distinct_skus: three boxes, three different skus', () => {
    const pkgs = buildOrderPackages('three_distinct_skus');
    expect(pkgs).toHaveLength(3);
    expect(distinctSkus(pkgs)).toHaveLength(3);
    expect(pkgs.every((p) => p.declaredBoxCount === 1)).toBe(true);
    expect(pkgs.every((p) => p.isGeneratedLabel === false)).toBe(true);
  });

  it('multi_box_sku: ONE sku occupying three boxes, shaped exactly like expand_carton', () => {
    const pkgs = buildOrderPackages('multi_box_sku');
    expect(pkgs).toHaveLength(3);

    const [parent, ...siblings] = pkgs;
    expect(parent).toMatchObject({
      labelSuffix: 'CTN-1',
      declaredBoxCount: 3,
      packageNumber: '1 de 3',
      isGeneratedLabel: false,
      parentLabelSuffix: null,
    });
    expect(parent.skuItems).toHaveLength(1);

    // expand_carton mints siblings as <parent>-2, <parent>-3 with an EMPTY
    // sku_items and the family denominator; mirroring that is what makes this
    // fixture indistinguishable from a real crew expansion.
    expect(siblings.map((p) => p.labelSuffix)).toEqual(['CTN-1-2', 'CTN-1-3']);
    expect(siblings.map((p) => p.packageNumber)).toEqual(['2 de 3', '3 de 3']);
    for (const s of siblings) {
      expect(s.isGeneratedLabel).toBe(true);
      expect(s.parentLabelSuffix).toBe('CTN-1');
      expect(s.declaredBoxCount).toBe(3);
      expect(s.skuItems).toEqual([]);
    }

    // The sku is carried only by the parent — one SKU across the family.
    expect(distinctSkus(pkgs)).toHaveLength(1);
  });

  it('multi_box_sku_plus_mono: the three-box family plus one standalone box', () => {
    const pkgs = buildOrderPackages('multi_box_sku_plus_mono');
    expect(pkgs).toHaveLength(4);
    expect(distinctSkus(pkgs)).toHaveLength(2);

    const mono = pkgs[3];
    expect(mono).toMatchObject({
      labelSuffix: 'CTN-2',
      declaredBoxCount: 1,
      packageNumber: '1 de 1',
      isGeneratedLabel: false,
      parentLabelSuffix: null,
    });

    // CTN-2 must not be mistaken for a sibling of CTN-1: the family's siblings
    // are CTN-1-2 / CTN-1-3, and a label collision between the two schemes
    // would break unique_label_per_operator on insert.
    const labels = pkgs.map((p) => p.labelSuffix);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('buildCargaOrders', () => {
  const orders = buildCargaOrders();

  it('is ten orders totalling twenty-eight boxes', () => {
    expect(orders).toHaveLength(10);
    const boxes = orders.reduce((n, o) => n + o.packages.length, 0);
    expect(boxes).toBe(28);
  });

  it('gives every box in an order a unique label suffix', () => {
    for (const order of orders) {
      const labels = order.packages.map((p) => p.labelSuffix);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it('starts every box at ingresado so all four cargas are collectable', () => {
    for (const order of orders) {
      for (const p of order.packages) expect(p.status).toBe('ingresado');
    }
  });

  it('numbers orders 1..10 within the carga', () => {
    expect(orders.map((o) => o.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('toPackageRows', () => {
  it('prefixes every label with the order number so it is unique per operator', () => {
    const rows = toPackageRows('CARGA-EASY-001-ORD-01', buildOrderPackages('three_distinct_skus'));
    expect(rows.map((r) => r.label)).toEqual([
      'CARGA-EASY-001-ORD-01-CTN-1',
      'CARGA-EASY-001-ORD-01-CTN-2',
      'CARGA-EASY-001-ORD-01-CTN-3',
    ]);
    expect(rows.every((r) => r.parentLabel === null)).toBe(true);
  });

  it('resolves a sibling parent_label to the parent’s real label', () => {
    const rows = toPackageRows('CARGA-PARIS-002-ORD-07', buildOrderPackages('multi_box_sku'));
    expect(rows[0].parentLabel).toBeNull();
    expect(rows[1]).toMatchObject({
      label: 'CARGA-PARIS-002-ORD-07-CTN-1-2',
      parentLabel: 'CARGA-PARIS-002-ORD-07-CTN-1',
    });
    expect(rows[2].parentLabel).toBe('CARGA-PARIS-002-ORD-07-CTN-1');
  });

  it('keeps every label in a whole carga distinct', () => {
    const labels = buildCargaOrders().flatMap((o) =>
      toPackageRows(`CARGA-EASY-001-ORD-${String(o.ordinal).padStart(2, '0')}`, o.packages).map(
        (r) => r.label,
      ),
    );
    expect(labels).toHaveLength(28);
    expect(new Set(labels).size).toBe(28);
  });
});
