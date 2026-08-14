# Spec-55: Carton Expansion — minting Aureon CTN IDs for undeclared boxes

> **Related:** [spec-53](spec-53-package-label-printing.md) (label printing — this is the follow-up recorded there), [spec-01](spec-01-epic4a-pickup-verification.md) / [spec-47](spec-47-pickup-route-and-consolidated-reception.md) (pickup verification), [spec-52](spec-52-pickup-route-vehicle-and-state-engine.md) (package state engine)

**Status:** backlog

_Date: 2026-08-14_

---

## Goal

Let the pickup crew, standing at the retailer with a CARTON_ID in front of them and **more boxes than that ID accounts for**, mint additional Aureon carton IDs on the spot — so every physical box becomes an individually scannable, individually tracked package that flows through reception, distribution and dispatch like any other.

## The problem

Ingest sends one `CARTON_ID` per manifest line. Some retailers ship a product that physically occupies several boxes and still send a single ID. Today those extra boxes are invisible: they have no `packages` row, no barcode, and no status. They ride the truck as cargo nobody is tracking, and any count that matters — reception, distribution, dispatch, billing — is wrong by however many boxes the retailer under-declared.

`packages.declared_box_count`, `is_generated_label` and `parent_label` were designed for exactly this, and the column comments describe an ingest-time splitting algorithm. **That algorithm was never implemented** (see spec-53's follow-up section): `intake-agent.ts` inserts one row per manifest line and passes `declared_box_count` through untouched. So this spec is the first implementation of carton splitting — and it splits on *observed* reality rather than declared data, because the retailer's declaration is precisely what's wrong.

## Decisions

Settled during brainstorming on 2026-08-14:

| Decision | Choice | Why |
|---|---|---|
| Parent CTN | **`CTN001` stays as box 1**; siblings `CTN001-2`, `CTN001-3` are added | The retailer's own barcode on box 1 keeps resolving, existing `pickup_scans` against `CTN001` stay valid, and nothing already recorded needs migrating |
| Print timing | **Create now, print at the hub**; mobile printing designed for but deferred | Ships with zero new hardware. The creation RPC and `PackageLabel` stay unchanged when the mobile path arrives — only the print trigger moves |
| Where | Inside the CTN verification screen (`/app/pickup/scan/[loadId]`) | Where the crew is when they discover the discrepancy |

## Non-Goals

- Mobile / in-field printing. Explicitly deferred; this spec must not foreclose it.
- Ingest-time splitting on `declared_box_count > 1`. A separate trigger, and arguably obsolete once observed expansion exists — reality beats the declaration either way.
- Merging or un-splitting cartons. Expansion is one-way; correcting a mistake is a soft delete (below).
- Re-billing or invoice adjustment. This spec makes the true box count *visible and auditable*; what commercial process consumes that is out of scope.
- Changing how any downstream scanner works. New cartons are ordinary packages — that is the whole design.

---

## Why downstream "just works"

The status chain is entirely trigger-driven on ordinary `packages` rows (`20260812000002_spec52_package_state_engine.sql`):

```
pickup scan  → packages.status = 'verificado'   (trigger on pickup_scans)
reception    → packages.status = 'en_bodega'    (trigger, 20260318000001)
packages     → orders.status roll-up            (trigger, latest 20260810000001)
```

A minted carton is a `packages` row with the same `order_id`, `status = 'ingresado'`, and a unique `label`. It therefore participates in every one of those links without a single change to the scan validators, the distribution flow, or the dispatch flow. **This is the core reason the parent-stays design was chosen** — no existing row changes meaning.

Two consequences that are *desirable* and must not be "fixed":

- The order will not roll up to a completed status until the new boxes are scanned too. That is the point.
- Reception's expected count rises. The hub will now be told to expect 3 boxes where the retailer's manifest said 1.

---

## Data model

No new tables. Minted cartons use the columns that already exist for this purpose:

| Column | Value on a minted carton |
|---|---|
| `label` | `{parent_label}-{n}`, n starting at 2 (box 1 is the parent) |
| `parent_label` | the parent's `label` (e.g. `CTN001`) |
| `is_generated_label` | `TRUE` |
| `order_id`, `operator_id` | copied from the parent |
| `declared_box_count` | set to the observed total on **all** siblings including the parent |
| `sku_items` | `'[]'::jsonb` — contents are not known per box, and guessing would be worse than empty |
| `status` | `'ingresado'` |
| `package_number` | `'{n} de {total}'`, and the parent is updated to `'1 de {total}'` |

`unique_label_per_operator UNIQUE (operator_id, label)` already guarantees no collision. The minting RPC must find the next free suffix rather than assuming `declared_box_count`, since a carton may be expanded twice.

### New column

| Column | Type | Purpose |
|---|---|---|
| `packages.created_by_user_id` | `UUID REFERENCES users(id)` | Who minted this carton. NULL for ingest-created rows. Expansion changes what the tenant is billed for; it needs a name against it. |

---

## RPC

### `expand_carton(p_package_id UUID, p_additional_boxes INT, p_reason TEXT)`

`SECURITY DEFINER`, operator-scoped, returns the created rows.

Rules:

1. Reject if the caller's `operator_id` does not own the package, or it is soft-deleted.
2. Reject `p_additional_boxes < 1` or `> 20` — a fat-fingered 300 should fail loudly, not create 300 cartons. The ceiling is arbitrary and documented as such.
3. Reject if the parent's `status` is past `verificado`. Once a package is in the warehouse, expanding it silently changes counts under flows already in motion; that case needs a different (and out-of-scope) correction path.
4. Reject empty `p_reason` — mirrors `enable_module_for_operator`'s mandatory reason, and for the same purpose: this is a human overriding what the retailer declared.
5. Mint `p_additional_boxes` rows, taking the next free `-n` suffix per the uniqueness constraint.
6. Update the parent and all siblings' `declared_box_count` and `package_number` to the new total.
7. Recompute `manifests.total_packages` for the affected manifest — it is denormalised and read by the scan screen's progress denominator, so a stale value shows `3/1`.

Undo is a soft delete of a minted carton, allowed only while `status = 'ingresado'`, via a separate `delete_minted_carton(p_package_id, p_reason)`. Deleting the parent is never allowed.

### Audit

Reuse the `operator_module_audit` pattern with a dedicated table `carton_expansion_audit` (append-only): `operator_id`, `package_id`, `parent_label`, `boxes_added`, `actor_user_id`, `reason`, `at`. Expansion is a human overriding retailer data and directly affects billing — it needs a record independent of the soft-deletable `packages` rows.

---

## UX

Inside `/app/pickup/scan/[loadId]`, on each package row in `ManifestDetailList`:

1. Crew taps **"Agregar bultos"** on the row for `CTN001`.
2. A sheet asks **how many additional boxes** (stepper, 1–20) and **why** (free text, required, with quick-pick reasons: "Producto de varias cajas", "Retailer declaró de menos", "Otro").
3. Confirm shows exactly what will be created: `CTN001-2`, `CTN001-3`.
4. On success the list re-renders with the new cartons inline under the parent, visually marked as Aureon-generated, and the progress denominator updates.
5. The new cartons are immediately scannable — the crew can verify them right away if they have labels, or leave them for the hub.

The new cartons appear in the pickup discrepancy flow (`DiscrepancyItem`) as a positive discrepancy — the truck carries more than the manifest declared — so the existing reconciliation screen tells the story rather than silently absorbing it.

### Labels

`get_manifest_label_data` needs no change: it returns one row per `packages` row, so minted cartons are included automatically, and spec-53's print button covers them. The label already renders `Bulto {package_number} de {declared_box_count}`, which now reads correctly.

Once a mobile printer is chosen, the only addition is a print trigger on the confirmation sheet — no change to the RPC or the label component.

---

## Edge cases

| Case | Behaviour |
|---|---|
| Expanding a carton twice | Allowed. Suffix search finds the next free `-n`; totals recomputed across all siblings. |
| Parent already has a `-2` from a previous expansion | Handled by the suffix search; never assume `declared_box_count` is the high-water mark. |
| Parent label already ends in `-n` (retailer's own format) | Suffix is appended to the full label (`CTN001-2-2`). Ugly but unambiguous, and the constraint holds. |
| Package past `verificado` | Rejected with a clear message pointing at the reason (see RPC rule 3). |
| Offline crew | The app has an offline scan store (`lib/offline/`). Expansion is **online-only** in this spec — it mints server-side identifiers that must be unique, and inventing them offline risks collisions. The button is disabled offline with an explicit message. |
| Order already rolled up | Cannot happen while the parent is at or before `verificado`, which rule 3 enforces. |

---

## Testing (TDD — tests first)

**pgTAP (`spec55_carton_expansion.sql`)**
- Minting creates exactly N rows with correct `label`, `parent_label`, `is_generated_label`, `order_id`.
- `declared_box_count` and `package_number` updated on parent *and* all siblings.
- Second expansion picks the next free suffix, no unique violation.
- Cross-operator call returns nothing / raises.
- Rejects `p_additional_boxes` of 0, negative, and 21.
- Rejects an empty reason.
- Rejects a parent past `verificado`.
- `manifests.total_packages` reflects the new count.
- An audit row is written with the actor and reason.
- **A minted carton reaching a pickup scan is promoted to `verificado` by the existing state-engine trigger** — the assertion that proves "behaves like a normal carton".

**Frontend**
- Sheet validates the count range and requires a reason.
- Confirmation lists the exact labels to be created.
- New cartons render inline under the parent, marked as generated.
- Progress denominator updates after expansion.
- Button disabled offline.
- RLS test that a foreign `operator_id` cannot expand.

---

## Rollout

1. Migration: `created_by_user_id`, `carton_expansion_audit`, `expand_carton`, `delete_minted_carton`.
2. Frontend sheet + list rendering, behind the existing `PICKUP` module (no new module key — this is core pickup behaviour, not an optional decoration).
3. QA with a seeded multi-box CARGA, verifying the full chain: expand → pickup scan → reception → distribution.
4. Mobile printing, if and when a printer is chosen, as a separate spec.
