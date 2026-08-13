/**
 * spec-53 — shared row shape returned by get_manifest_label_data(p_manifest_id, p_package_id).
 * One row per `packages` record; consumed by PackageLabel, PrintPackageLabels
 * and the print route's server component.
 */
export interface ManifestLabelRow {
  package_id: string;
  package_label: string;
  package_number: string | null;
  declared_box_count: number | null;
  sku_items: Array<{ sku: string; description: string; quantity: number }>;
  order_number: string;
  customer_name: string;
  delivery_address: string;
  comuna: string;
  customer_phone: string;
  external_load_id: string;
  retailer_name: string | null;
}
