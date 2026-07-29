# Ops scripts

Ad-hoc, manually-run backfill and sync scripts. **None of these run in CI or on deploy.**

All credentials come from the environment — no script contains a hardcoded key. Export what
the script needs before running, or it will fail fast:

| Variable | Used by | Where to get it |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | all backfill/sync scripts | Supabase Dashboard → Project Settings → API |
| `DISPATCHTRACK_API_KEY` | `backfill-dispatches*.mjs`, `sync-pending-orders.mjs` | DispatchTrack account admin |

These keys bypass RLS and write to production. Prefer `--dry-run` first where supported.

| Script | What it does | Idempotent? |
|---|---|---|
| `backfill-dispatches.mjs` | Backfills `dispatches` from the DispatchTrack Filter Dispatches endpoint. Supports `--dry-run`, `--max-pages=N`. | Yes (upsert by `external_dispatch_id`) |
| `backfill-dispatches-by-order.mjs` | Same target table, keyed by order instead of date range. | Yes |
| `sync-pending-orders.mjs` | Pulls current DispatchTrack state for orders still pending. | Yes |
| `backfill-paris-packages.mjs` | Recovers missing Paris `packages` rows from `orders.raw_data` after an n8n UPSERT batch failure. Supports `--dry-run`. | Yes |
| `backfill-paris-export-triggers.mjs` | Re-fires export triggers for Paris orders. | Yes |
| `start-frontend.js` / `start-mobile.js` | Local dev launchers (npm-workspace hoisting workarounds). | N/A |

Scripts are tenant-scoped to a hardcoded operator ID today — see `REMEDIATION.md` item C6.
