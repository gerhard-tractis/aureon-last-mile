#!/usr/bin/env bash
#
# resolve-supabase-pooler-host.sh — turns a Supabase project's region into its
# IPv4-reachable Supavisor pooler hostname (spec-87 fase 4 follow-up).
#
# WHY THIS EXISTS
# ----------------
# prod-backfill-loaded-route-id.yml and prod-readonly-query.yml both connected
# with `psql` straight to `db.<project-ref>.supabase.co:5432` — Supabase's
# DIRECT connection, which resolves to an IPv6-only address. GitHub Actions'
# hosted runners have no IPv6 route, so every `psql` call failed with
# "Network is unreachable" the first time either workflow actually ran
# (dry_run of the backfill, run 34520594735).
#
# The fix is Supabase's pooler (Supavisor), which is dual-stack and reachable
# over IPv4: `aws-0-<region>.pooler.supabase.com`. The region is not something
# this repo can hardcode — it is not recorded anywhere in the repo, and
# guessing it would silently rot the moment the project migrated regions. The
# workflow instead calls the Supabase Management API
# (`GET https://api.supabase.com/v1/projects/{ref}`) with the
# SUPABASE_ACCESS_TOKEN secret it already has, and pipes the JSON response
# body into this script.
#
# Reading the response from stdin (rather than curling here) keeps this
# script testable without network access or credentials — see
# resolve-supabase-pooler-host.test.sh.
#
# Deliberately no `jq` dependency: this repo's local dev shell doesn't have
# jq installed (see scripts/resolve-supabase-pooler-host.test.sh), and the
# only field this script needs out of the Management API response is a single
# top-level string, which a plain `grep`/`sed` extraction handles without
# pulling in a parser. ubuntu-latest ships jq anyway, so this isn't a CI
# constraint — it's what keeps the test suite runnable everywhere.
#
# EXIT CODES
#   0  region resolved — the pooler host is printed to stdout, nothing else
#   1  the response had no usable `region` field (missing, null, or the body
#      was a Management API error / not JSON at all) — refuses to guess
#
set -euo pipefail

body="$(cat)"

# Matches `"region": "us-east-1"` (any whitespace around the colon). A JSON
# `null` or a missing key both fail to match — the quoted-string requirement
# is deliberate, not accidental strictness.
region="$(printf '%s' "$body" \
  | grep -o '"region"[[:space:]]*:[[:space:]]*"[^"]*"' \
  | head -1 \
  | sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/' || true)"

if [ -z "$region" ] || [ "$region" = "null" ]; then
  echo "::error::could not resolve the Supabase project's region from the Management API response — refusing to guess a pooler host. Response body: ${body}" >&2
  exit 1
fi

echo "aws-0-${region}.pooler.supabase.com"
