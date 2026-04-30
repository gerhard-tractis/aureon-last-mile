# spec-40 — Dock-zone barcode labels (printable)

**Status:** backlog

## Goal

Let an operations manager generate and print physical barcode labels for each `dock_zones` row, so warehouse operators can scan the printed label during the existing `scan_anden` step in `QuickSortScanner` instead of typing the code by hand. The barcode encodes the dock's existing `code` field — the same value `dock-scan-validator.ts` already validates against — so no scanning logic changes.

## Background

The distribution scanner workflow already ends with `scan_anden` (`apps/frontend/src/components/distribution/QuickSortScanner.tsx:23,59`), where the operator scans a destination dock barcode that gets validated by `validateDockDestination` in `apps/frontend/src/lib/distribution/dock-scan-validator.ts`. Today there is no way to *produce* the physical label. Operators either remember dock codes or rely on hand-written signs. As the warehouse adds new docks (and as new operators are onboarded — most clients of this product still operate on paper + Excel), the missing labels become a friction point.

This spec only adds the print path. The data model, the scanning logic, and the dock-management settings page remain unchanged.

## Out of scope

- Editing or generating dock `code` values (already managed in `DockZoneForm`).
- Bulk relabel/rotation tools, label expiration, or audit logging of label printing.
- Mobile-printer integration (Bluetooth Zebra ZQ520, etc.). Office laser/inkjet on A4 is the only target.
- Any change to `dock-scan-validator.ts`, `QuickSortScanner`, `BatchScanner`, or `dock_zones`.

## Scope

**In scope:**

- New `DockLabel` presentational component that renders one A4-landscape label (header band, big code, full-width Code128 barcode).
- New print route `/app/distribution/settings/labels/print?zoneIds=<csv>` rendering one `DockLabel` per zone with auto-print on mount.
- Two entry buttons on `/app/distribution/settings`: per-row "Imprimir" in `DockZoneList`, and a top-level "Imprimir todos" for batch printing of all active non-consolidation zones.
- New dependency `bwip-js` for client-side Code128 SVG rendering.
- Tests for the component, the print page, and the new buttons.

## UX

### Single-label flow

1. Manager opens `/app/distribution/settings`.
2. Clicks "Imprimir" on the row for `DOCK-001` (Santiago Oriente).
3. New tab opens at `/app/distribution/settings/labels/print?zoneIds=<dock-001-uuid>`.
4. Page renders the label, then automatically opens the browser print dialog (`window.print()`).
5. Manager picks a physical printer or "Save as PDF" — both routes work.

### Batch flow

1. Manager clicks "Imprimir todos" at the top of the settings page.
2. Same route opens with all active non-consolidation zone UUIDs comma-joined.
3. Page renders one label per zone, each on its own A4 landscape page (`page-break-after: always` between labels).
4. Browser print dialog fires once; the resulting print job / PDF contains every dock label back-to-back.

### Label layout

Confirmed during brainstorming (mockup `label-layout-v4.html`). A4 landscape, 28×32 px page padding, inside the page:

- **Header band** (border-bottom 2 px solid): small uppercase `ANDÉN` tag (left, 13 px / letter-spacing 4 px / muted) and the zone's `name` (right, 28 px / weight 700).
- **Dock code**, centered, 96 px / weight 800, top-padding 16 px.
- **56 px gap** for visual separation.
- **Code128 SVG**, full label width, ~170 px tall.
- **Caption** under the barcode: same code in `Courier New` 22 px / letter-spacing 12 px (operator's last-resort fallback if the barcode is damaged).

### Print CSS and layout escape

The print route lives at `apps/frontend/src/app/app/distribution/settings/labels/print/page.tsx`, which means it inherits both `app/app/layout.tsx` (the global `<AppLayout>` chrome) and `app/app/distribution/layout.tsx` (permission gate, passthrough). A child route in the App Router cannot opt out of ancestor layouts, so the chrome WILL render on screen.

We accept the on-screen chrome and hide it from print output using a media query:

```css
@page { size: A4 landscape; margin: 0; }
@media print {
  /* Hide everything by default, then re-show only the print root */
  body > * { display: none !important; }
  body .dock-label-print-root { display: block !important; }
  body { background: white; }
  .dock-label { page-break-after: always; }
  .dock-label:last-child { page-break-after: auto; }
}
```

`PrintLabels` renders its labels inside a `<div className="dock-label-print-root">` so the rule above isolates the print output to that subtree only. The user briefly sees the chrome on screen while the print dialog opens — that's intentional and harmless.

(Note: `body > * { display: none }` also hides Next.js portals attached to `<body>` — toasts, dialogs, the route-announcer. That's the desired behaviour for a print job; flagged here so a future maintainer doesn't restore one of those by accident.)

(Considered escaping the layout via a Route Group at `app/(print)/...`, but it would change the URL and require a new layout file. The CSS approach is one rule and stays put.)

## Architecture

### New files

- `apps/frontend/src/components/distribution/DockLabel.tsx` — pure presentational, ~80 lines, props `{ code: string; name: string }`. Uses `bwip-js`'s `toSVG()` API to generate a Code128 SVG string and dangerously-sets it inside a `<div>`. No hooks, no state. Uses `bcid: 'code128'`, `text: code`, `includetext: false`, `height: 30`, `paddingwidth: 4`.
- `apps/frontend/src/components/distribution/DockLabel.test.tsx` — renders the component with sample props, asserts the code text and the name appear, and a `<svg>` Code128 element is present.
- `apps/frontend/src/app/app/distribution/settings/labels/print/page.tsx` — server component that reads `zoneIds` from `searchParams`, queries `dock_zones` for that operator, hands data to a small `<PrintLabels>` client component.
- `apps/frontend/src/app/app/distribution/settings/labels/print/PrintLabels.tsx` — client component that renders each `<DockLabel>` inside a `<div className="dock-label-print-root">` (so the print CSS can isolate output to this subtree) and calls `window.print()` once images are painted (single `useEffect` with a `requestAnimationFrame` chain). If `zones` is empty, renders a "No hay andenes para imprimir" message and skips the print() call.
- `apps/frontend/src/app/app/distribution/settings/labels/print/PrintLabels.test.tsx` — given a `zones` array, asserts N `dock-label` nodes are rendered and `window.print` is called once on mount.

### Modified files

- `apps/frontend/src/components/distribution/DockZoneList.tsx` — two changes:
  1. Add a small "Imprimir" link per row inside the existing card body. Opens the print route in a new tab via `<a href="…" target="_blank" rel="noopener">`.
  2. Add an "Imprimir todos" link in the existing top header next to the existing `Agregar andén` button (already inside this component, lines 38–41). The href joins all active non-consolidation zone UUIDs by comma.
- `apps/frontend/src/components/distribution/DockZoneList.test.tsx` — assert both new links render and produce the correct hrefs (per-row and batch). The settings page itself is unchanged.
- `apps/frontend/package.json` — add `bwip-js` (latest stable, MIT).

### Why client-side `bwip-js`

Considered three render strategies during brainstorming:

| Approach | Verdict |
|---|---|
| Client-side `bwip-js` (chosen) | ~85 KB minified, MIT, zero round-trip, works offline, drops an SVG straight into the print page. |
| Server-side render via Route Handler | Same library, but adds a round-trip per label for output that never changes for a given code. |
| Hosted barcode-generator API | Rejected — sends dock codes to a third party for no benefit. |

`bwip-js` only loads on the print route, so the regular settings bundle is unaffected.

### Data model — no migration

Nothing changes in `dock_zones`. The barcode is a visual representation of the existing `code` column, which is already what `validateDockDestination` compares against. Multi-tenant scoping comes for free via the standard `operator_id = public.get_operator_id()` RLS already on the table.

## Authorization

`apps/frontend/src/app/app/distribution/layout.tsx` gates every route under `/app/distribution/**` on `hasPermission(permissions, 'distribution')`. The print route lives under that segment so it inherits the same permission check — no new auth wiring needed. No new RLS policy is required either: the print route's only data access is a `dock_zones` SELECT, which is already scoped on `operator_id = public.get_operator_id()` by the existing RLS policy on the table.

Inactive zones can be printed via the per-row "Imprimir" button (the manager may need a label for a dock that's temporarily disabled). The "Imprimir todos" batch action only includes `is_active = true AND is_consolidation = false` zones.

## Tests

Following the project's TDD non-negotiable, written before implementation:

1. `DockLabel.test.tsx`
   - Renders with `{ code: 'DOCK-001', name: 'Santiago Oriente' }`.
   - Asserts the code text appears in the centered position.
   - Asserts the name appears in the header band.
   - Asserts an `<svg>` element produced by `bwip-js` is present (smoke check via attribute / aria-label).

2. `PrintLabels.test.tsx`
   - Mock `window.print`.
   - Render with two zones; assert two label nodes are rendered.
   - Assert `window.print` is called exactly once after mount.

3. `DockZoneList.test.tsx`
   - For an active non-consolidation row, asserts an "Imprimir" link with `href="/app/distribution/settings/labels/print?zoneIds=<uuid>"` and `target="_blank"`.

4. `settings/page.test.tsx` (extend if it exists, otherwise skip)
   - Asserts "Imprimir todos" link href contains every active non-consolidation zone UUID joined by comma.

## File-size guard

All new files stay well under the 300-line limit. `DockLabel.tsx` ~80 lines, `PrintLabels.tsx` ~40 lines, the print page server component ~40 lines.

## Implementation steps

1. Add `bwip-js` to `apps/frontend/package.json`; run install.
2. Write `DockLabel.test.tsx` (failing).
3. Implement `DockLabel.tsx` until the test passes.
4. Write `PrintLabels.test.tsx` (failing).
5. Implement `PrintLabels.tsx` and the server `page.tsx` until the test passes.
6. Add the per-row Imprimir button to `DockZoneList.tsx` with its test.
7. Add the "Imprimir todos" link to the `DockZoneList` header (next to `Agregar andén`) with its test.
8. Manually verify in dev: open the print route for `DOCK-001`, scan the resulting on-screen barcode with a DS2208 (after the country-code reconfiguration), confirm it round-trips through `validateDockDestination`.
9. Branch → PR (`feat/spec-40-dock-zone-barcode-labels`) → auto-merge per `CLAUDE.md`.
