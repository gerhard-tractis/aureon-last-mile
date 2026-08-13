# QA Workflow Test Scope (spec-51)

The manual end-to-end test plan. Work through this against the QA environment
before any phased-rollout cutover.

**Environment:** the spec-48 VPS QA stack — see `docs/qa-environment.md` for
setup, the SSH tunnel one-liner, and DB reset. All four services run there
together (frontend, agents, worker, solver), which is why this is the E2E
environment and Vercel Preview is not: a preview deployment is the Next.js app
alone and cannot exercise agent, worker, or solver workflows.

**Preconditions:** QA stack up, migrations replayed, `seed-qa.sql` applied, the
six `qa-*@qa.test` users created, and the scenario seed run
(`npm run seed:qa -- --scenarios=all`, spec-51 PR 4).

**Access:**

```bash
ssh -L 3200:localhost:3200 -L 8100:localhost:8100 -L 8101:localhost:8101 \
    -L 3211:localhost:3211 aureon@<VPS_IP>
```

Frontend http://localhost:3200 · Studio http://localhost:8101 · Bull Board
http://localhost:3211. All QA users share the password `QaTest123!`.

## How to use this document

Each workflow lists its precondition (the seed scenario supplying the state), the
role to sign in as, the steps, and the expected result. **Where an order status
is expected, verify it in Studio, not just in the UI** — `orders.status` is
derived by `trg_recalculate_order_status` from package statuses, so the UI
showing the right badge does not prove the derivation is correct.

Record failures against the spec listed in the right-hand column.

---

## 1. Ingestion

| # | Workflow | Role | Expected |
|---|---|---|---|
| 1.1 | CSV/Excel bulk import via `/app/orders/import` | admin | Orders land `ingresado`; invalid rows rejected with per-row errors; rate limit 100/min holds |
| 1.2 | Manual order entry via `/app/orders/new` | operations_manager | Order `ingresado`, one package, comuna normalized via `orders_normalize_comuna` |
| 1.3 | Easy WMS webhook replay | — | `scripts/replay-easy-webhook.mjs` against QA. Orders + packages upserted; `dispatch_guide_url` stored verbatim (spec-49); raw JSON archived; `jobs` row written |
| 1.4 | Duplicate `order_number` | admin | Upsert on `(operator_id, order_number)` — no duplicate row created |
| 1.5 | OCR camera intake | warehouse_staff | `intake_submissions` row progresses `received → parsing → parsed`; a low-confidence extract lands `needs_review` |
| 1.6 | Unmatched comuna | admin | Order accepted, `comuna_raw` retained, appears in `get_unmatched_comunas` |

> **Known issue — 1.3.** `MUSAN_OPERATOR_ID` is hardcoded in
> `packages/database/supabase/functions/beetrack-webhook/index.ts:14` and in the
> Easy WMS n8n workflow JSON. Without the operator override added in spec-51
> PR 4, webhook ingestion lands in the wrong tenant.

## 2. Pickup (tenant warehouse → hub) — module `pickup`

| # | Workflow | Role | Expected |
|---|---|---|---|
| 2.1 | Pending manifest list `/app/pickup` | pickup_crew | Only this operator's manifests, `reception_status = awaiting_reception` |
| 2.2 | Scan load `/app/pickup/scan/[loadId]` | pickup_crew | Valid label → `verified`; unknown → `not_found`; rescan → `duplicate`. Packages advance `ingresado → verificado` |
| 2.3 | Review + discrepancies | pickup_crew | Missing packages recorded in `discrepancy_notes` |
| 2.4 | Complete load with signature | pickup_crew | Signature stored in the `manifests` bucket; manifest `completed` |
| 2.5 | Start pickup route | pickup_crew | `start_pickup_route(p_vehicle_id)` requires a vehicle from `vehicles` and creates the route **`in_progress`** (spec-52 — there is no longer a `draft` state); second concurrent route for the same driver **rejected** (unique partial index) |
| 2.6 | Add manifests, hand off at the hub | pickup_crew + warehouse_staff | Driver adds manifests and shows the route QR; the **receptionist's scan** opens the batch via `open_route_reception`, which moves the route to `in_transit` and creates the `route_receptions` row. `close_pickup_route` still exists but is deprecated — the driver no longer closes their own route |
| 2.7 | Route QR `/app/pickup/route/[routeId]/qr` | pickup_crew | QR renders and resolves to the route |
| 2.8 | Cancel route | operations_manager | `cancel_pickup_route` → `cancelled`; manifests released |

## 3. Hub reception (spec-47) — module `reception`

| # | Workflow | Role | Expected |
|---|---|---|---|
| 3.1 | Reception queue `/app/reception` | warehouse_staff | In-transit routes listed |
| 3.2 | Consolidated reception `/app/reception/route/[routeId]` | warehouse_staff | `get_route_reception_snapshot` totals correct across all manifests on the route |
| 3.3 | Scan received packages | warehouse_staff | Packages `verificado → en_bodega`; received count increments via trigger |
| 3.4 | Wrong-route scan | warehouse_staff | Result `route_mismatch`, package not received |
| 3.5 | Complete with shortfall | warehouse_staff | `complete_route_reception` **requires** `discrepancy_notes` when received < expected |
| 3.6 | Complete clean | warehouse_staff | Route `received`; manifests `reception_status = received` |

## 4. Distribution / dock sorting — module `distribution`

| # | Workflow | Role | Expected |
|---|---|---|---|
| 4.1 | Open batch `/app/distribution/batch` | warehouse_staff | Batch `open` |
| 4.2 | Scan to mapped zone | warehouse_staff | `accepted`; package → `sectorizado` |
| 4.3 | Scan to wrong zone | warehouse_staff | `wrong_zone`, no status change |
| 4.4 | Scan unmapped comuna | warehouse_staff | `unmapped`, surfaced for mapping |
| 4.5 | Consolidation zone | warehouse_staff | `is_consolidation` zone → package `retenido`, not `sectorizado` |
| 4.6 | Eyes-on verification (spec-39) | warehouse_staff | `dock_verifications` rows for both `scan` and `tap` |
| 4.7 | Close batch `/confirm` | operations_manager | Batch `closed`; orders with zero active packages → `cancelado` |
| 4.8 | Quicksort | warehouse_staff | Same transitions as the batch flow |
| 4.9 | Zone/label printing | admin | Barcode labels render and scan back correctly (spec-40) |

## 5. Pre-route and dispatch — modules `pre_route`, `dispatch`

| # | Workflow | Role | Expected |
|---|---|---|---|
| 5.1 | Pre-route tab | operations_manager | `get_pre_route_snapshot` groups by andén/zone correctly |
| 5.2 | Create route | operations_manager | `create_seeded_route` → route `draft` |
| 5.3 | Load truck `/app/dispatch/[routeId]` | loading_crew | Scans → packages `en_carga`; wrong-package scan rejected by `scan-validator` |
| 5.4 | Remove package from route | loading_crew | Package reverts; route counts update |
| 5.5 | Close route | operations_manager | Route ready to dispatch |
| 5.6 | Dispatch to DispatchTrack | operations_manager | Route `draft → planned`; packages → `en_ruta`. **In QA, DT is not reachable — expect a clean, surfaced failure, not a silent one** |
| 5.7 | Cancel route | operations_manager | Route `cancelled`; packages revert |

> **Gap — 5.1.** The `pre_route` module key is never read outside the registry.
> `PreRouteTab` renders unconditionally inside `dispatch/page.tsx`, gated only by
> `DISPATCH`. Toggling `pre_route` off has no effect. See §8.

## 6. Delivery outcomes and returns — module `returns`

Driven by the DispatchTrack webhook, not a driver app — there is no driver POD
application. Simulate via the seed scenarios or a webhook replay.

| # | Workflow | Expected `orders.status` |
|---|---|---|
| 6.1 | All packages delivered (DT status 2) | `entregado` |
| 6.2 | Failed delivery (DT status 3/4) → `process_failed_delivery` | packages `retorno_hub`, order `en_retorno` |
| 6.3 | Some delivered, some failed | `parcialmente_entregado` |
| 6.4 | Order cancelled / zero active packages | `cancelado` |
| 6.5 | Return reception scan → `complete_return_reception_scan` | packages back to `en_bodega` |
| 6.6 | Returns panel in Operations Control | Returns branch of `get_ops_control_snapshot` matches the DB |
| 6.7 | Damaged / lost | `dañado`, `extraviado`, `devuelto` reachable and displayed |

**Verify each of 6.1–6.4 in Studio.** These are the derivation rules in
`recalculate_order_status`, and they are the single most load-bearing piece of
status logic in the product.

## 7. Operations Control, dashboards, conversations

| # | Workflow | Role | Expected |
|---|---|---|---|
| 7.1 | Ops Control `/app/operations-control` | operations_manager | Single `get_ops_control_snapshot` RPC; stage panels match DB counts |
| 7.2 | Dashboard `/app/dashboard` | operations_manager | North-star metrics, OTIF by customer/region, late reasons |
| 7.3 | Capacity planning | operations_manager | `get_capacity_utilization`, `check_capacity_and_alert` fires at threshold |
| 7.4 | Conversations `/app/conversations` | operations_manager | Inbound/outbound across channels; reply and close work |
| 7.5 | WISMO notifications | — | All 11 `wismo_type_enum` values render; delivery statuses tracked |
| 7.6 | Reschedule flow | operations_manager | `order_reschedules` statuses and reasons applied to the order |
| 7.7 | Global order inspector (spec-42) | admin | Finds any order/package across stages |
| 7.8 | Audit logs `/app/audit-logs` | admin | Entries for the actions taken above |

## 8. Tenant operations

The seed provides a **second operator** so isolation is testable. Sign in as
each operator's own admin.

| # | Check | Expected |
|---|---|---|
| 8.1 | Cross-tenant read | Operator A's admin sees **zero** of operator B's orders, routes, drivers, manifests |
| 8.2 | Cross-tenant RPC (REMEDIATION C4) | SECURITY DEFINER RPCs reject a caller-supplied foreign `operator_id` via `assert_operator_access()` |
| 8.3 | super_admin visibility | `qa-super-admin@qa.test` sees across operators; a tenant admin does not |
| 8.4 | Module toggle `/app/admin/modules` | super_admin only; writes `operator_enabled_modules` + `operator_module_audit` |
| 8.5 | Guard enforcement | With a module off, its route 404s/redirects for that operator and disappears from nav — verify per module |
| 8.6 | All modules off | Only Admin plus a "no modules enabled" landing (Phase 0 exit criterion, `docs/architecture/phased-rollout-strategy.md`) |
| 8.7 | Role matrix | All six roles × every screen: each sees and can do exactly what its role allows |
| 8.8 | Operator onboarding | Create a new operator end to end: operator → users → modules → `tenant_clients` → `pickup_points` → `dock_zones` → drivers, then ingest a first order |
| 8.9 | Endpoint auth (REMEDIATION C5) | Unauthenticated API calls fail **closed**; Bull Board has no default credentials |

> **Gap — 8.5.** Only 6 of 9 module keys are enforced. `ops_control`, `pickup`,
> `reception`, `distribution`, `dispatch`, and `conversations` have layout
> guards. `pre_route` and `returns` are toggleable but gate nothing (they are
> sub-views of `dispatch` and `operations_control`). `late_order_alerts` has no
> implementation yet — expected, its feature is still backlog in the rollout map.
> Test 8.5 against the six enforced modules and treat the other three as known
> gaps for a spec-46 follow-up, not as new failures.

## 9. Regression set — recently merged, never E2E tested

Everything below shipped but has not been exercised end to end. Prioritise it.

| Spec / PR | What to re-verify | Sections |
|---|---|---|
| spec-45 (#342/#345/#346) | Module activation tables, `super_admin` role, admin toggle UI | 8.4, 8.6 |
| spec-46 (#344) | Layout guards + sidebar nav filtering | 8.5 |
| spec-47 (#347–#352) | Pickup route → consolidated reception | 2.5–2.8, 3.1–3.6 |
| spec-43 (#337/#338/#343) | Failed delivery return flow, `retorno_hub` | 6.2, 6.5, 6.6 |
| spec-49 (#364) | Easy WMS `url_guia` stored verbatim; form-urlencoded body parsing | 1.3 |
| REMEDIATION C4 (#356) | Cross-tenant SECURITY DEFINER RPCs | 8.2 |
| REMEDIATION C5 (#357) | Fail-closed endpoint auth, no default Bull Board creds | 8.9 |
| #351 | All modules enabled for the Transportes Musan tenant | 8.5 |

## 10. Infrastructure checks

Run alongside the workflow passes.

1. **Migration parity** — `SELECT count(*) FROM supabase_migrations.schema_migrations`
   on `:5433` equals `ls packages/database/supabase/migrations/*.sql | wc -l`.
2. **Isolation proof** — for each QA unit,
   `sudo grep -c 'supabase.co' /proc/$(systemctl show -p MainPID --value aureon-worker-qa)/environ`
   returns `0`. Repeat for `aureon-agents-qa`, `aureon-frontend-qa`.
3. **Queues alive** — Bull Board at :3211 shows jobs processing.
4. **Worker on QA DB** — `journalctl -u aureon-worker-qa -n 50` mentions
   `localhost:5433`, never `supabase.co`.
5. **Seed assertions pass** — `npm run seed:qa -- --verify`, including the
   `pg_enum` drift check.
6. **Prod drift gate green** — the `verify-prod-migrations` job on the latest
   main run. QA sign-off means nothing if production's schema differs.

## Out of scope

- Settlement, `exceptions`, `assignments` — schema exists, no application code.
- Driver POD app — does not exist.
- `apps/mobile` — not wired into any deploy job.
- Automated E2E. The specs in `apps/frontend/e2e/` are smoke shells with no auth
  fixture; they pass on a login redirect and prove nothing.
