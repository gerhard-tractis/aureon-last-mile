# Spec-53: Aureon Package Label Printing

> **Related:** [spec-40](spec-40-dock-zone-barcode-labels.md) (print pattern this reuses), [spec-45](spec-45-module-activation-layer.md) (module activation), [spec-42](spec-42-order-inspector.md) (single-package reprint entry point), [spec-47](spec-47-pickup-route-and-consolidated-reception.md) (pickup routes and manifests)

**Status:** in progress

_Date: 2026-08-13_

---

## Goal

Print Aureon-quality 10 × 10 cm package labels at the hub **before the pickup crew departs**, so that every scan from hub reception onward reads a clean Code128 instead of the retailer's degraded barcode.

**One label per `packages` row.** That is the unit this spec prints, and it is worth being precise about what that does and does not cover.

`packages.declared_box_count` records how many physical boxes a manifest line represents, and the schema anticipates splitting those into sub-labels (`CTN001-1/-2/-3` via `is_generated_label` + `parent_label`). **That splitting is not implemented.** `intake-agent.ts:131-141` inserts exactly one `packages` row per manifest line and passes `declared_box_count` through untouched; no production code has ever created a sub-label row. So a manifest line declaring three boxes is one row, one label, three physical boxes — and this spec prints one label for it.

Multi-box expansion is therefore a real, separate gap, deferred to the follow-up described at the end of this spec. Spec-53 stands on its own regardless: it fixes barcode *quality* for the single-box case, which is the overwhelming majority of volume.

## Background

Tenant-supplied labels are frequently low quality — faded thermal print, wrinkled adhesive, toner smear — which makes them unreliable to scan at pickup verification, hub reception, distribution sorting and dispatch. Every failed scan degrades into manual entry, which is slow and error-prone, and the target tenants operate on paper + Excel with untrained crews (see `docs/architecture/phased-rollout-strategy.md`).

Two alternatives were considered during brainstorming:

1. **Mobile printer with the pickup crew** — the crew prints a manifest's labels at the retailer.
2. **Hub printing before departure** — executives print the stack and hand it to the crew.

**Alternative 2 was chosen.** Ingest data for a trip is complete and stable before the crew leaves, so field printing would add Bluetooth printer hardware, battery management and a mobile print path to solve a problem that does not exist. If ingest timing ever changes per tenant, alternative 1 becomes a follow-up spec, not a redesign — the label component and data RPC defined here are reusable as-is.

## Non-Goals

- Mobile / in-field printing (Zebra ZQ-class Bluetooth units).
- ZPL generation or any raw-print path.
- Label stock other than 10 × 10 cm.
- Any change to `pickup/scan-validator.ts`, `reception/reception-scan-validator.ts`, `distribution/dock-scan-validator.ts`, or any other scan logic — see "Barcode payload" below for why none is needed.
- Printing at hub reception or distribution instead of before pickup.
- Reprint audit history beyond the two columns in "Data layer".
- Replacing or covering the tenant's own label. Aureon labels are applied **in addition**; placement on the box is an operational matter, not a product one.

## Prerequisites

- spec-01 / spec-47 — `manifests`, `packages`, `orders` and the pickup flow.
- spec-45 — module activation layer (`ModuleKey`, `requireModuleEnabled`).
- spec-40 — the print pattern (`DockLabel.tsx`, `PrintLabels.tsx`) and the `bwip-js` dependency, both already in `apps/frontend`.

---

## How the label reaches the right box

This is the decision the rest of the design hangs on.

The crew has a stack of Aureon labels and a pile of physical boxes. Matching is **by eye against the tenant's own label**: the crew reads the tracking number printed on the retailer's label and finds the Aureon label bearing the same number. There is no scan of the bad barcode at any point.

Two consequences follow, and both are load-bearing:

1. **The client's tracking number must be the visually dominant element on the label.** It is the matching key, and a misread here puts the wrong label on the wrong box, corrupting every downstream scan silently. This is why layout "match-first" was chosen over a comuna-dominant layout.
2. **The manifest ID must be unmistakable.** The stack is grouped by manifest; a crew working the wrong pile at a retailer is the worst realistic failure mode. Hence the large top band.

Should sub-label rows ever exist (the schema supports them; nothing creates them today), the match is deliberately loose: three identical boxes under `CTN001` would receive `CTN001-1/-2/-3` in any order, since the boxes are interchangeable and any assignment is correct.

### Barcode payload

The Code128 encodes **`packages.label` verbatim** — the exact value the retailer's barcode carries and the exact value every existing validator already resolves. The Aureon label is a *quality re-print*, not a second identity.

This is why no scan logic changes. It also means a box carrying both labels is harmless: whichever barcode a scanner happens to read yields the same value.

---

## Data layer

One migration adds two columns and two functions.

### Columns on `manifests`

| Column | Type | Notes |
|---|---|---|
| `labels_printed_at` | `TIMESTAMPTZ` | Nullable. Set on every successful print job; overwritten on reprint. |
| `labels_printed_by` | `UUID REFERENCES public.users(id)` | Nullable. Who triggered the most recent print. |

Manifest-level rather than package-level: the only question anyone asks operationally is "has `CARGA-001` been printed yet?" Per-package print counters would put a hot column on a high-volume table to serve a report nobody has requested.

### `mark_manifest_labels_printed(p_manifest_id UUID) RETURNS VOID`

`SECURITY DEFINER`. Sets both columns to `NOW()` and `auth.uid()`. Scoped to the caller's `operator_id`; raises if the manifest belongs to another operator or is soft-deleted.

### `get_manifest_label_data(p_manifest_id UUID) RETURNS TABLE(...)`

`SECURITY DEFINER`, `operator_id`-filtered, `deleted_at IS NULL` on every joined table. One row per package, joining `manifests → orders → packages`.

Returned columns:

| Column | Source |
|---|---|
| `package_id` | `packages.id` |
| `package_label` | `packages.label` — the barcode payload and the eye-match key |
| `package_number` | `packages.package_number` |
| `declared_box_count` | `packages.declared_box_count` |
| `sku_items` | `packages.sku_items` |
| `order_number` | `orders.order_number` |
| `customer_name` | `orders.customer_name` |
| `delivery_address` | `orders.delivery_address` |
| `comuna` | `orders.comuna` |
| `customer_phone` | `orders.customer_phone` |
| `external_load_id` | `manifests.external_load_id` |
| `retailer_name` | `manifests.retailer_name` |

**Ordering — `ORDER BY orders.order_number, packages.package_number, packages.label`.** The printed stack must mirror the order in which the crew walks the manifest; an arbitrary order forces them to fan through the whole stack per box.

Accepts an optional `p_package_id UUID DEFAULT NULL`; when supplied, returns that single package only (the reprint path).

---

## Module activation

Add to `apps/frontend/src/lib/modules/registry.ts`:

```ts
PACKAGE_LABELS = 'package_labels',
```

with `navHref: null` (like `LATE_ORDER_ALERTS` — it has no nav entry of its own, it decorates the pickup module).

Whether a tenant's labels are bad enough to warrant reprinting is exactly the kind of per-tenant variable spec-45 exists to control. Riding under `PICKUP` would force a code change to turn it off for one tenant.

Default OFF for all operators, including the existing one — enabling it is a config flip plus a training session, per the phased rollout strategy.

---

## Label design

**Format:** 100 × 100 mm (Zebra 4 × 4"). Chosen over 4 × 6" after seeing both rendered at physical size; 4 × 4 costs roughly a third of the surface, and the product detail is what pays for it.

**Layout, top to bottom:**

| Zone | Content | Size |
|---|---|---|
| Top band (black, reversed) | `MANIFIESTO` label + `external_load_id` · `AUREON` + `retailer_name` | manifest ID at 7 mm mono bold |
| Match block | `ETIQUETA DEL CLIENTE` caption · **`package_label`** · `Bulto {package_number} de {declared_box_count}` · `order_number` | label at 8.5 mm mono bold |
| Barcode | Code128 of `package_label`, full width | 13 mm tall |
| Thick rule | — | 1 mm |
| Destination | `comuna` · `customer_name` · `delivery_address` · `customer_phone` | comuna 5.6 mm bold, name 3.9 mm |
| Thin rule | — | 0.3 mm |
| Contents | First 2 lines of `sku_items` as `{quantity}× {description}`, then `+N ítems más` when truncated | 2.5 mm |

The manifest ID sits in the top band specifically so it is readable when the labels are fanned straight out of the printer, before anyone separates the stack.

Product detail is deliberately the lowest-priority element: it is always retrievable in the app, whereas a misread tracking number is silent and unrecoverable.

---

## Components and routes

### `PackageLabel.tsx` (`components/pickup/`)

Presentational, `'use client'`, renders exactly one 100 × 100 mm label. Props map 1:1 to the RPC row. Code128 via `bwip-js/browser` following `DockLabel.tsx` — including its `preserveAspectRatio="none"` + explicit `width`/`height` injection, which exists because bwip-js emits an SVG with no intrinsic sizing.

SKU truncation happens here: 2 lines, then `+N ítems más`.

### `PrintPackageLabels.tsx` (`app/app/pickup/manifests/[manifestId]/labels/print/`)

Print root. Copies the isolation approach from `PrintLabels.tsx`:

```css
@page { size: 100mm 100mm; margin: 0; }
```

plus the `visibility: hidden` / `position: static` reset on `body *` (rather than `display: none`, which would cascade and hide the print root's own descendants), `page-break-after: always` between labels, and `window.print()` on mount behind a one-paint-cycle timeout.

After the print dialog is dispatched, calls `mark_manifest_labels_printed`. It does **not** wait for a print confirmation — browsers do not report one — so the column means "a print job was dispatched", and the spec's UI copy reflects that.

### Route `/app/pickup/manifests/[manifestId]/labels/print`

Server component. `requireModuleEnabled(ModuleKey.PACKAGE_LABELS)` → `notFound()` when disabled. Fetches via `get_manifest_label_data`. Accepts `?packageId=<uuid>` for the single-label reprint.

### Entry points

- **`ManifestCard.tsx`** — "Imprimir etiquetas" button, opening the print route in a new tab. Once `labels_printed_at` is set the button reads "Reimprimir etiquetas" and opens a confirm dialog naming the date and the user who last printed. Hidden entirely when the module is disabled.
- **Order inspector (spec-42)** — per-package printer icon on each package row, opening the same route with `?packageId=`. This is the torn-label path; without it a single damaged label means reprinting an entire manifest.

---

## UX flow

1. Executive opens `/app/pickup` at the hub and finds the manifest for the trip, e.g. `CARGA-001`.
2. Clicks **Imprimir etiquetas**. A new tab opens, renders every label for the manifest grouped by order, and fires the browser print dialog.
3. Executive selects the Zebra (configured with 4 × 4 stock) and prints. The stack emerges grouped by order, manifest ID readable on every label.
4. The manifest card now shows "Etiquetas impresas — 13 ago 2026, 08:41, por Gerhard".
5. Crew takes the stack to the retailer, reads each box's own label, finds the Aureon label with the matching number, applies it.
6. From hub reception onward every scan reads the Aureon barcode.

---

## Edge cases

| Case | Behaviour |
|---|---|
| Manifest with zero packages | Friendly empty state; no print dialog; `labels_printed_at` **not** written. Mirrors `PrintLabels.tsx`'s zero-zone guard. |
| `package_number` null | Render `1 de {declared_box_count}`. The column is free-form retailer text with no validation or uniqueness — it is never parsed, only displayed. |
| `declared_box_count` null | Render the package label alone, no "Bulto" line. |
| `sku_items` empty array | Contents block renders its caption and nothing else; no crash, no empty bullet. |
| Very long `delivery_address` | Clamped to 2 lines with CSS `line-clamp`; the address is a courier aid, and the authoritative copy is in the app. |
| Large manifest (300+ packages) | `bwip-js` renders synchronously per label, so a large manifest is one long commit. Measure during implementation; if it stalls the tab, paginate the print job with an explicit "imprimiendo 1–200 de 430" banner. **Never silently truncate.** |
| `declared_box_count > 1` | **Known limitation.** One label prints for the row. The crew applies it to one box; the other boxes travel without an Aureon barcode, exactly as they do today. The label still shows "Bulto 1 de 3", so the gap is visible to the crew rather than silent. Resolved by the follow-up below — not worked around here. |
| Reprint | Overwrites `labels_printed_at` / `labels_printed_by`. No versioning, no history table. |
| Module disabled mid-session | Route returns 404 via `requireModuleEnabled`; the button is absent from `ManifestCard`. |

---

## Testing (TDD — tests first)

**`PackageLabel.test.tsx`**
- Renders every field from a full row.
- Renders the Code128 SVG with `packages.label` as payload.
- Truncates `sku_items` to 2 lines and shows `+N ítems más`.
- A row with `is_generated_label: true` and a `parent_label` renders identically to a native label (schema-supported today, unused until the follow-up ships).
- Null `package_number` falls back to `1 de N`.

**`PrintPackageLabels.test.tsx`**
- Calls `window.print()` exactly once.
- Calls `mark_manifest_labels_printed` after dispatching print.
- Zero packages → empty state, no print, no RPC call.
- Renders one label per package in the order received.

**Print route test**
- Module disabled → `notFound()`.
- `?packageId=` renders exactly one label.
- Label order matches the RPC's ordering.

**`ManifestCard.test.tsx`**
- Button hidden when module disabled.
- Reads "Imprimir etiquetas" when `labels_printed_at` is null, "Reimprimir etiquetas" otherwise.
- Reprint opens a confirm dialog showing the previous print date and user.

**RLS test (`__tests__/`)**
- `get_manifest_label_data` returns nothing for a manifest belonging to another operator.
- `mark_manifest_labels_printed` raises for a foreign manifest.
- Soft-deleted packages and orders are excluded.

---

## Rollout

1. Migration + RPCs (no behaviour change on their own).
2. `ModuleKey.PACKAGE_LABELS`, default OFF everywhere.
3. Component, print route, entry points.
4. Enable for the pilot tenant after a print test on the physical Zebra with real stock — the one step no test can cover, because label sizing depends on the printer driver's paper configuration.

---

## Follow-up (deferred): box expansion and field label generation

Deliberately out of scope here, recorded so it is not lost. **Deferred at the user's request on 2026-08-13**, pending a mobile-printer decision.

### The gap

A `packages` row can represent several physical boxes, and nothing splits it into individually labelled units. That gap has two triggers:

| Trigger | Where | Source of truth |
|---|---|---|
| **Declared** | Hub, before departure | `declared_box_count > 1` from ingest |
| **Observed** | Retailer, during pickup | The crew counts more boxes than the manifest declares — common when a retailer under-reports box counts on multi-SKU orders |

Both need the same mechanism: expand one `packages` row into N rows following the existing `parent_label` / `is_generated_label` convention, and print a label per resulting box. The observed case subsumes the declared one, because reality at the retailer overrides the manifest either way.

### Why it can't be designed yet

The observed case requires printing at the retailer, and the print path from a phone to a Bluetooth label printer is **not** the hub's browser-print mechanism. The realistic options — Web Bluetooth sending raw ZPL from Chrome on Android, a share-sheet handoff to Zebra Print Connect, or a native wrapper — differ in feasibility by printer brand and model, and no printer has been selected. Designing around an unchosen device would be guesswork.

### What the follow-up spec must settle

1. **Hardware first.** Which printer, confirmed by a spike that actually prints a Code128 from the crew's device before any application design is committed.
2. **Code minting.** Sub-label format (`{parent_label}-{n}` per the column comment), uniqueness under `unique_label_per_operator`, and what happens to the parent row once expanded — does it remain scannable, or is it superseded by its children?
3. **Who may expand.** Field expansion mutates package counts after ingest; it needs a role check and an audit trail, since it changes what the tenant is billed for and what the manifest reconciles against.
4. **Discrepancy interaction.** Pickup already has a discrepancy flow (`DiscrepancyItem.tsx`). Expansion must feed that flow rather than compete with it — an undeclared box is a discrepancy first and a label second.
5. **Whether the hub case ships first.** Expanding on `declared_box_count` at the hub needs no new hardware and could ship independently, ahead of the field path.
