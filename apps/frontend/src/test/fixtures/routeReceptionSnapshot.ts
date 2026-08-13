import type {
  RouteReceptionSnapshot,
} from '@/hooks/reception/useRouteReceptionSnapshot';

/**
 * Shared fixture for `get_route_reception_snapshot` responses.
 *
 * WHY THIS FILE EXISTS. `page.test.tsx` and `useRouteReceptionSnapshot.test.ts`
 * each used to carry their own hand-written, *untyped* snapshot literal. Both
 * happened to use the keys the interface declares — which the RPC did not
 * actually return between 2026-06-25 and 2026-08-13. So the page's unit tests
 * were green for six months while the page threw TypeError on render in
 * production. The component was being validated against a fiction.
 *
 * `satisfies RouteReceptionSnapshot` is what makes the fixture honest: it is a
 * compile-time assertion in both directions. A field renamed or removed from
 * the interface fails type-check here; an excess-property check rejects any key
 * the interface does not declare. The fixture can no longer drift away from the
 * contract without `npm run type-check` going red.
 *
 * THE OTHER HALF OF THE LOOP. This file pins fixture <-> interface. It cannot
 * pin interface <-> RPC — no TypeScript can, the RPC returns `jsonb`. That side
 * is pinned by packages/database/supabase/tests/route_reception_snapshot_contract.sql,
 * which asserts the RPC's exact top-level key set and the inner shape of each
 * array. Together the two close the loop that was open: divergence between the
 * database and the interface now fails the SQL contract test, and divergence
 * between the interface and these tests now fails type-check.
 *
 * Keep this shaped like a REAL response. It deliberately mirrors the RPC's
 * semantics: `discrepancies` is derived from the non-`received` reception
 * scans, so it stays `[]` here because `scans` holds only a `received` scan.
 * Interface-declared fields only — the RPC also emits `customer_name` and
 * `retailer_name` on expected_packages, but those are not part of the contract
 * the frontend reads and the excess-property check would reject them.
 */
export const routeReceptionSnapshotFixture = {
  route: {
    id: 'r1',
    code: 'PR-2026-0001',
    driver_id: 'd1',
    driver_name: 'Ana Ruiz',
    plate: 'AAA-111',
    status: 'in_transit',
    in_transit_at: null,
  },
  route_reception: {
    id: 'rr1',
    status: 'in_progress',
    expected_count: 3,
    received_count: 1,
    unexpected_count: 0,
    started_at: null,
    completed_at: null,
    discrepancy_notes: null,
  },
  manifests: [
    { id: 'm1', external_load_id: 'CARGA-001', retailer_name: 'Easy' },
    { id: 'm2', external_load_id: 'CARGA-002', retailer_name: 'Sodimac' },
  ],
  expected_packages: [
    { id: 'pkg-1', label: 'PKG-A', order_id: 'o1', order_number: '101', manifest_id: 'm1', status: 'verificado' },
    { id: 'pkg-2', label: 'PKG-B', order_id: 'o1', order_number: '101', manifest_id: 'm1', status: 'verificado' },
    { id: 'pkg-3', label: 'PKG-C', order_id: 'o2', order_number: '202', manifest_id: 'm2', status: 'verificado' },
  ],
  scans: [
    {
      id: 's1',
      barcode: 'PKG-A',
      scan_result: 'received',
      package_id: 'pkg-1',
      scanned_at: '2026-06-25T10:00:00Z',
    },
  ],
  discrepancies: [],
} satisfies RouteReceptionSnapshot;

/**
 * Same route, but the receptionist scanned a barcode belonging to no package on
 * the route, and separately double-tapped a package already scanned.
 *
 * Mirrors the RPC's semantics exactly: `discrepancies` is a strict subset of
 * `scans` holding only `not_found` and `route_mismatch`. The `duplicate` scan
 * appears in `scans` but NOT in `discrepancies` — a double-tap is an operator
 * input artefact, not a discrepancy in the goods. Same rule as
 * ConsolidatedScanList.tsx:74 and the `discrepancies` query in migration
 * 20260813000001; keep all three in step.
 */
export const routeReceptionSnapshotWithDiscrepancyFixture = {
  ...routeReceptionSnapshotFixture,
  scans: [
    ...routeReceptionSnapshotFixture.scans,
    {
      id: 's2',
      barcode: 'BOGUS-404',
      scan_result: 'not_found',
      package_id: null,
      scanned_at: '2026-06-25T10:01:00Z',
    },
    {
      id: 's3',
      barcode: 'PKG-A',
      scan_result: 'duplicate',
      package_id: 'pkg-1',
      scanned_at: '2026-06-25T10:02:00Z',
    },
  ],
  discrepancies: [{ barcode: 'BOGUS-404', scanned_at: '2026-06-25T10:01:00Z' }],
} satisfies RouteReceptionSnapshot;
