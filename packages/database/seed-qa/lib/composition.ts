/**
 * The Musan carga composition matrix.
 *
 * Every carga holds the same ten orders, two of each of five package shapes.
 * The shapes exist to separate two things the rest of the product keeps
 * conflating — how many SKUs an order carries, and how many BOXES those SKUs
 * occupy:
 *
 *   mono                      1 sku  → 1 box
 *   repeated_sku_three_boxes  1 sku  → 3 boxes, each its own declared carton
 *   three_distinct_skus       3 skus → 3 boxes
 *   multi_box_sku             1 sku  → 3 boxes of ONE declared carton
 *   multi_box_sku_plus_mono   the above + 1 more sku in its own box
 *
 * `repeated_sku_three_boxes` and `multi_box_sku` both produce three rows and
 * one SKU, and are the pair most worth testing against each other: the first
 * is three cartons the retailer declared and labelled, the second is one
 * carton the retailer declared and the crew had to expand. Reception,
 * distribution and billing count them identically; the label printer and the
 * scan denominator do not.
 *
 * The second shape is modelled exactly as `expand_carton`
 * (20260814000002_spec55_carton_expansion.sql) leaves a family behind —
 * parent keeps its label and box 1, siblings are `<parent>-2`, `<parent>-3`
 * with `is_generated_label`, `parent_label`, the shared denominator and an
 * empty `sku_items`. A fixture that got that wrong would test a state the
 * application can never produce.
 */

/** A SKU line inside a package, matching packages.sku_items' JSONB shape. */
export interface SkuItem {
  sku: string;
  description: string;
  quantity: number;
}

/** One package row, described relative to its order rather than absolutely. */
export interface SeedPackage {
  /** Appended to the order number to form packages.label. */
  labelSuffix: string;
  skuItems: SkuItem[];
  declaredBoxCount: number;
  packageNumber: string;
  isGeneratedLabel: boolean;
  /** Suffix of the parent's label, for minted siblings only. */
  parentLabelSuffix: string | null;
  status: string;
}

export type CompositionKey =
  | 'mono'
  | 'repeated_sku_three_boxes'
  | 'three_distinct_skus'
  | 'multi_box_sku'
  | 'multi_box_sku_plus_mono';

/** Shown in orders.customer_name so a tester can tell the shapes apart on screen. */
export const COMPOSITION_LABELS: Record<CompositionKey, string> = {
  mono: '1 SKU / 1 bulto',
  repeated_sku_three_boxes: '1 SKU / 3 bultos declarados',
  three_distinct_skus: '3 SKU / 3 bultos',
  multi_box_sku: '1 SKU multibulto (3)',
  multi_box_sku_plus_mono: '1 SKU multibulto (3) + 1 SKU mono',
};

/**
 * Two of each shape, grouped so the pairs sit next to each other in any list
 * sorted by order number.
 */
export const CARGA_COMPOSITION: CompositionKey[] = [
  'mono',
  'mono',
  'repeated_sku_three_boxes',
  'repeated_sku_three_boxes',
  'three_distinct_skus',
  'three_distinct_skus',
  'multi_box_sku',
  'multi_box_sku',
  'multi_box_sku_plus_mono',
  'multi_box_sku_plus_mono',
];

/** Every box starts collectable — all four cargas are seeded pending. */
const START_STATUS = 'ingresado';

function sku(code: string, description: string): SkuItem {
  return { sku: code, description, quantity: 1 };
}

/** A carton the retailer declared and labelled itself: one box, one row. */
function declaredBox(labelSuffix: string, item: SkuItem): SeedPackage {
  return {
    labelSuffix,
    skuItems: [item],
    declaredBoxCount: 1,
    packageNumber: '1 de 1',
    isGeneratedLabel: false,
    parentLabelSuffix: null,
    status: START_STATUS,
  };
}

/**
 * A SKU that physically occupies `boxes` cartons under a single retailer
 * label — the parent plus the siblings `expand_carton` would have minted.
 */
function cartonFamily(parentSuffix: string, item: SkuItem, boxes: number): SeedPackage[] {
  const family: SeedPackage[] = [
    {
      labelSuffix: parentSuffix,
      skuItems: [item],
      declaredBoxCount: boxes,
      packageNumber: `1 de ${boxes}`,
      isGeneratedLabel: false,
      parentLabelSuffix: null,
      status: START_STATUS,
    },
  ];

  for (let n = 2; n <= boxes; n++) {
    family.push({
      labelSuffix: `${parentSuffix}-${n}`,
      // Empty, exactly as expand_carton mints them: the SKU is declared once,
      // on the parent, and the siblings are the boxes it turned out to need.
      skuItems: [],
      declaredBoxCount: boxes,
      packageNumber: `${n} de ${boxes}`,
      isGeneratedLabel: true,
      parentLabelSuffix: parentSuffix,
      status: START_STATUS,
    });
  }

  return family;
}

/** Build the package rows for one order of the given shape. */
export function buildOrderPackages(key: CompositionKey): SeedPackage[] {
  switch (key) {
    case 'mono':
      return [declaredBox('CTN-1', sku('MUS-MONO-001', 'Hervidor eléctrico 1.7L'))];

    case 'repeated_sku_three_boxes': {
      const item = sku('MUS-UNIBOX-002', 'Silla comedor roble');
      return ['CTN-1', 'CTN-2', 'CTN-3'].map((suffix) => declaredBox(suffix, item));
    }

    case 'three_distinct_skus':
      return [
        declaredBox('CTN-1', sku('MUS-MIX-003', 'Set sartenes 3 piezas')),
        declaredBox('CTN-2', sku('MUS-MIX-004', 'Lámpara de pie')),
        declaredBox('CTN-3', sku('MUS-MIX-005', 'Alfombra 120x170')),
      ];

    case 'multi_box_sku':
      return cartonFamily('CTN-1', sku('MUS-TRIBOX-006', 'Sofá 3 cuerpos (3 bultos)'), 3);

    case 'multi_box_sku_plus_mono':
      return [
        ...cartonFamily('CTN-1', sku('MUS-TRIBOX-006', 'Sofá 3 cuerpos (3 bultos)'), 3),
        declaredBox('CTN-2', sku('MUS-MONO-007', 'Cojín decorativo')),
      ];
  }
}

export interface CargaOrder {
  /** 1..10 within the carga. */
  ordinal: number;
  composition: CompositionKey;
  packages: SeedPackage[];
}

/** The ten orders every carga carries. */
export function buildCargaOrders(): CargaOrder[] {
  return CARGA_COMPOSITION.map((composition, i) => ({
    ordinal: i + 1,
    composition,
    packages: buildOrderPackages(composition),
  }));
}

/** Distinct SKU codes across a set of packages — sibling rows carry none. */
export function distinctSkus(packages: SeedPackage[]): string[] {
  return [...new Set(packages.flatMap((p) => p.skuItems.map((s) => s.sku)))];
}

/** A package row with its labels resolved against the order it belongs to. */
export interface PackageRow {
  label: string;
  parentLabel: string | null;
  skuItems: SkuItem[];
  declaredBoxCount: number;
  packageNumber: string;
  isGeneratedLabel: boolean;
  status: string;
}

/**
 * Resolve label suffixes against an order number.
 *
 * `packages.label` is unique per operator (`unique_label_per_operator`), so the
 * order number has to be part of it — two orders in the same carga both carry a
 * `CTN-1`. `parent_label` is resolved the same way, since expand_carton finds a
 * family by matching a sibling's parent_label against a real label.
 */
export function toPackageRows(orderNumber: string, packages: SeedPackage[]): PackageRow[] {
  return packages.map((p) => ({
    label: `${orderNumber}-${p.labelSuffix}`,
    parentLabel: p.parentLabelSuffix === null ? null : `${orderNumber}-${p.parentLabelSuffix}`,
    skuItems: p.skuItems,
    declaredBoxCount: p.declaredBoxCount,
    packageNumber: p.packageNumber,
    isGeneratedLabel: p.isGeneratedLabel,
    status: p.status,
  }));
}
