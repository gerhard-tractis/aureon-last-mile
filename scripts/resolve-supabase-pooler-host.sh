#!/usr/bin/env bash
#
# resolve-supabase-pooler-host.sh — turns a Supabase project's Supavisor
# pooler config (as returned by the Management API) into the connection
# parameters `psql` actually needs (spec-87 fase 4 follow-up, round 3).
#
# WHY THIS EXISTS
# ----------------
# prod-backfill-loaded-route-id.yml and prod-readonly-query.yml both
# connected with `psql` straight to `db.<project-ref>.supabase.co:5432` —
# Supabase's DIRECT connection, which resolves to an IPv6-only address.
# GitHub Actions' hosted runners have no IPv6 route, so every `psql` call
# failed with "Network is unreachable" the first time either workflow
# actually ran (dry_run of the backfill, run 34520594735). #750 fixed that
# by switching to Supabase's pooler (Supavisor), which is dual-stack — but
# it BUILT the pooler hostname from a template,
# `aws-0-<region>.pooler.supabase.com`, using only the project's region.
# That template is not universal: the third dry_run (run 34525271852) hit a
# real, IPv4-reachable Supavisor host that nonetheless answered
# `FATAL: tenant/user postgres.<ref> not found` — the templated host and
# user belonged to a DIFFERENT cluster than the one actually hosting this
# project. Guessing the host from the region silently breaks for any
# project that isn't on that cluster's default shard.
#
# THE FIX: ask the Management API for the pooler config directly instead of
# building it. `GET /v1/projects/{ref}/config/database/pooler` (operationId
# `v1-get-pooler-config`, tag "Database") returns an ARRAY of
# `SupavisorConfigResponse` — one entry per database on the project (at
# least a PRIMARY entry, and one per read replica if any exist). Each entry
# carries `db_host`, `db_port`, `db_user`, `db_name`, `pool_mode` and a
# ready-made `connection_string`. This is the exact same endpoint and
# response shape the Supabase CLI itself uses to link a project's pooler
# locally (`supabase/cli`,
# apps/cli/src/command-internal/link-services-core.ts, `linkPooler`):
# `configs.find((c) => c.database_type === "PRIMARY")`.
#
# This script mirrors that: it picks the PRIMARY entry and prints its
# `db_host`, `db_port`, `db_user` and `pool_mode` as `NAME=VALUE` lines —
# deliberately the same shape `$GITHUB_OUTPUT` wants, so a workflow step can
# pipe this script's stdout straight into it without any reformatting. It
# never composes a host, port or username from a template again: every
# value comes verbatim from the Management API response.
#
# ON POOL_MODE: #750 chose transaction mode (6543) because every `psql -c`
# call in both workflows is its own connection with no session state to
# carry between invocations — transaction mode is the right shape for that.
# This script does NOT force a mode: it reports whatever `pool_mode`/
# `db_port` PRIMARY's entry actually carries, with a `::notice::` if it
# isn't "transaction". The Management API's answer wins over any hardcoded
# assumption — if a project's default pooler entry is ever configured for
# session mode, the workflow will use session mode's host/port too, exactly
# as the API described it, not silently keep pretending it got transaction
# mode.
#
# NO jq: this repo's local dev shell doesn't have jq installed (see
# resolve-supabase-pooler-host.test.sh) — everything here is grep/sed only.
# The Management API response is a flat-object array (every field in
# SupavisorConfigResponse is a primitive — no nested objects/arrays), which
# is what makes a non-nested-brace regex safe here.
#
# EXIT CODES
#   0  PRIMARY entry found with usable db_host/db_port/db_user — those three
#      (plus pool_mode) are printed to stdout as NAME=VALUE lines, nothing
#      else
#   1  the response was not a usable array of pooler configs, had no
#      PRIMARY entry, or PRIMARY was missing db_host/db_port/db_user —
#      refuses to guess
#
set -euo pipefail

body="$(cat)"

# Collapse to one line so a pretty-printed (multi-line) response is parsed
# the same as a minified one — the field-boundary regexes below assume no
# embedded newlines inside a value.
flat="$(printf '%s' "$body" | tr '\n' ' ')"

# Every field in SupavisorConfigResponse is a primitive, so a top-level
# object never contains a nested `{`/`}` — a non-greedy match up to the
# first `}` after each `{` safely captures one array element at a time.
objects="$(printf '%s' "$flat" | grep -oP '\{[^{}]*\}' || true)"

if [ -z "$objects" ]; then
  echo "::error::could not parse the Supabase Management API pooler config response as a JSON array of objects — refusing to guess. Response body: ${body}" >&2
  exit 1
fi

primary=""
while IFS= read -r obj; do
  if printf '%s' "$obj" | grep -qP '"database_type"\s*:\s*"PRIMARY"'; then
    primary="$obj"
    break
  fi
done <<< "$objects"

if [ -z "$primary" ]; then
  echo "::error::no entry with database_type=PRIMARY in the Supabase Management API pooler config response — refusing to guess. Response body: ${body}" >&2
  exit 1
fi

extract_field() {
  # $1: field name, $2: object substring. A field absent from the object is
  # not an error here — the caller decides that — so grep finding zero
  # matches must not fail this function under `set -e -o pipefail` (pipefail
  # would otherwise surface grep's exit 1 as the whole pipeline's status
  # even though head/sed both still exit 0 on the resulting empty input).
  printf '%s' "$2" \
    | { grep -oP "\"$1\"\s*:\s*\"?[^\",}]*\"?" || true; } \
    | head -1 \
    | sed -E "s/\"$1\"[[:space:]]*:[[:space:]]*\"?([^\",}]*)\"?/\1/"
}

db_host="$(extract_field db_host "$primary")"
db_port="$(extract_field db_port "$primary")"
db_user="$(extract_field db_user "$primary")"
pool_mode="$(extract_field pool_mode "$primary")"

missing=""
for pair in "db_host:$db_host" "db_port:$db_port" "db_user:$db_user"; do
  name="${pair%%:*}"
  value="${pair#*:}"
  if [ -z "$value" ] || [ "$value" = "null" ]; then
    missing="${missing}${missing:+, }${name}"
  fi
done

if [ -n "$missing" ]; then
  echo "::error::PRIMARY entry in the Supabase Management API pooler config is missing required field(s): ${missing} — refusing to guess. Response body: ${body}" >&2
  exit 1
fi

if [ -n "$pool_mode" ] && [ "$pool_mode" != "null" ] && [ "$pool_mode" != "transaction" ]; then
  echo "::notice::Supabase Management API reports pool_mode=${pool_mode} for this project's PRIMARY pooler entry, not transaction — using it as-is (db_port=${db_port}) rather than the transaction-mode assumption in the workflow header." >&2
fi

echo "db_host=${db_host}"
echo "db_port=${db_port}"
echo "db_user=${db_user}"
echo "pool_mode=${pool_mode}"
