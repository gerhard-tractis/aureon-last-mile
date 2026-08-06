#!/usr/bin/env bash
# =============================================================================
# generate-qa-secrets.sh — fill CHANGE_ME_* placeholders in the QA env file
# (spec-48). See env.qa.example for the full variable reference.
#
# Usage:
#   ./generate-qa-secrets.sh [TARGET_FILE] [--force] [--verify]
#
#   TARGET_FILE  defaults to /home/aureon/.env.qa. Created from
#                env.qa.example (next to this script) if absent.
#   --force      regenerate ALL generated secrets, even ones already filled.
#   --verify     verify only (no writes): JWTs re-checked against JWT_SECRET,
#                no CHANGE_ME left, no forbidden characters. Exits non-zero
#                on any failure.
#
# All generated values are plain hex so the file stays safe for its three
# consumers (docker compose --env-file, systemd EnvironmentFile=, bash source):
# no quotes, spaces, $, #, or = padding.
#
# SENTRY_DSN: apps/agents/src/config.ts requires it non-empty (zod .min(1)),
# so we fill an inert but syntactically valid DSN pointing at qa.invalid —
# the Sentry SDK accepts it but can never resolve/deliver anywhere.
# OPENROUTER_API_KEY is external and NEVER generated here.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLE_FILE="$SCRIPT_DIR/env.qa.example"

TARGET="/home/aureon/.env.qa"
FORCE=0
VERIFY_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --verify) VERIFY_ONLY=1 ;;
    -h|--help) sed -n '2,22p' "${BASH_SOURCE[0]}"; exit 0 ;;
    -*) echo "ERROR: unknown option: $arg" >&2; exit 2 ;;
    *) TARGET="$arg" ;;
  esac
done

fail() { echo "ERROR: $*" >&2; exit 1; }

command -v openssl >/dev/null 2>&1 || fail "openssl is required"
command -v node    >/dev/null 2>&1 || fail "node is required"

get_var() { # get_var KEY -> prints current value (first match)
  awk -v k="$1" 'BEGIN{FS="="} $1==k{print substr($0,length(k)+2); exit}' "$TARGET"
}

set_var() { # set_var KEY VALUE — in-place, preserves comments/order
  local tmp="$TARGET.tmp.$$"
  awk -v k="$1" -v v="$2" 'BEGIN{FS="="}
    !done && $1==k { print k"="v; done=1; next }
    { print }' "$TARGET" > "$tmp" && mv "$tmp" "$TARGET"
}

ensure() { # ensure KEY VALUE — set only if placeholder (or --force)
  local key="$1" val="$2" cur
  grep -q "^$key=" "$TARGET" || fail "$key not found in $TARGET"
  cur="$(get_var "$key")"
  if [ "$FORCE" = "1" ] || [[ "$cur" == CHANGE_ME* ]]; then
    set_var "$key" "$val"
    echo "  set $key"
  else
    echo "  keep $key (already set; use --force to regenerate)"
  fi
}

mint_jwt() { # mint_jwt ROLE — HS256 JWT signed with $JWT_SECRET_VAL, no npm deps
  node -e '
    const c = require("crypto");
    const [secret, role] = process.argv.slice(1);
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const header = b64({ alg: "HS256", typ: "JWT" });
    const payload = b64({ role, iss: "supabase", iat: now, exp: now + 10 * 365 * 24 * 3600 });
    const sig = c.createHmac("sha256", secret).update(header + "." + payload).digest("base64url");
    process.stdout.write(header + "." + payload + "." + sig);
  ' "$JWT_SECRET_VAL" "$1"
}

check_jwt() { # check_jwt ROLE TOKEN — recompute HMAC + check claims
  node -e '
    const c = require("crypto");
    const [secret, role, token] = process.argv.slice(1);
    const parts = token.split(".");
    if (parts.length !== 3) { console.error("  FAIL " + role + ": not a JWT"); process.exit(1); }
    const [h, p, s] = parts;
    const expect = c.createHmac("sha256", secret).update(h + "." + p).digest("base64url");
    if (s !== expect) { console.error("  FAIL " + role + ": signature does not match JWT_SECRET"); process.exit(1); }
    const claims = JSON.parse(Buffer.from(p, "base64url").toString());
    if (claims.role !== role) { console.error("  FAIL: role claim is " + claims.role + ", expected " + role); process.exit(1); }
    if (claims.iss !== "supabase") { console.error("  FAIL " + role + ": iss is " + claims.iss); process.exit(1); }
    if (!(claims.exp > Date.now() / 1000)) { console.error("  FAIL " + role + ": token expired"); process.exit(1); }
    console.log("  OK " + role + " JWT (signature, role, iss, exp)");
  ' "$JWT_SECRET_VAL" "$1" "$2"
}

check_len() { # check_len KEY OP N (OP: -ge | -eq)
  local val len
  val="$(get_var "$1")"; len=${#val}
  if [ "$len" "$2" "$3" ]; then echo "  OK $1 length $len"; else
    echo "  FAIL $1 length $len (need $2 $3)" >&2; return 1; fi
}

verify() {
  local rc=0 line key val
  echo "Verifying $TARGET"
  [ -f "$TARGET" ] || fail "$TARGET does not exist"
  while IFS= read -r line; do
    case "$line" in ''|\#*) continue ;; esac
    key="${line%%=*}"; val="${line#*=}"
    if [[ "$val" == CHANGE_ME* ]]; then
      if [ "$key" = "OPENROUTER_API_KEY" ]; then
        echo "  WARN OPENROUTER_API_KEY still a placeholder (external key — set it manually)"
      else
        echo "  FAIL $key still contains a CHANGE_ME placeholder" >&2; rc=1
      fi
    fi
    # Allowed charset per env.qa.example header (plus @ for DSN/email values).
    if ! [[ "$val" =~ ^[A-Za-z0-9._:/,@-]*$ ]]; then
      echo "  FAIL $key contains forbidden characters (quotes/spaces/\$/#/=...)" >&2; rc=1
    fi
  done < "$TARGET"
  JWT_SECRET_VAL="$(get_var JWT_SECRET)"
  check_jwt anon "$(get_var ANON_KEY)" || rc=1
  check_jwt service_role "$(get_var SERVICE_ROLE_KEY)" || rc=1
  [ "$(get_var NEXT_PUBLIC_SUPABASE_ANON_KEY)" = "$(get_var ANON_KEY)" ] \
    && echo "  OK NEXT_PUBLIC_SUPABASE_ANON_KEY matches ANON_KEY" \
    || { echo "  FAIL NEXT_PUBLIC_SUPABASE_ANON_KEY != ANON_KEY" >&2; rc=1; }
  for k in SUPABASE_SERVICE_KEY SUPABASE_SERVICE_ROLE_KEY; do
    [ "$(get_var "$k")" = "$(get_var SERVICE_ROLE_KEY)" ] \
      && echo "  OK $k matches SERVICE_ROLE_KEY" \
      || { echo "  FAIL $k != SERVICE_ROLE_KEY" >&2; rc=1; }
  done
  [ "$(get_var SUPABASE_DB_PASSWORD)" = "$(get_var POSTGRES_PASSWORD)" ] \
    && echo "  OK SUPABASE_DB_PASSWORD matches POSTGRES_PASSWORD" \
    || { echo "  FAIL SUPABASE_DB_PASSWORD != POSTGRES_PASSWORD" >&2; rc=1; }
  check_len JWT_SECRET -ge 40 || rc=1
  check_len SECRET_KEY_BASE -ge 64 || rc=1
  check_len REALTIME_DB_ENC_KEY -eq 16 || rc=1
  check_len PG_META_CRYPTO_KEY -ge 32 || rc=1
  check_len ENCRYPTION_KEY -eq 64 || rc=1
  check_len BULL_BOARD_PASSWORD -ge 12 || rc=1
  [ -n "$(get_var SENTRY_DSN)" ] && echo "  OK SENTRY_DSN non-empty (required by apps/agents/src/config.ts)" \
    || { echo "  FAIL SENTRY_DSN is empty" >&2; rc=1; }
  if [ "$rc" -eq 0 ]; then echo "Verification PASSED"; else echo "Verification FAILED" >&2; fi
  return "$rc"
}

if [ "$VERIFY_ONLY" = "1" ]; then
  verify
  exit $?
fi

if [ ! -f "$TARGET" ]; then
  [ -f "$EXAMPLE_FILE" ] || fail "template not found: $EXAMPLE_FILE"
  mkdir -p "$(dirname "$TARGET")"
  cp "$EXAMPLE_FILE" "$TARGET"
  echo "Created $TARGET from env.qa.example"
fi
chmod 600 "$TARGET" 2>/dev/null || true

echo "Generating secrets in $TARGET"
# Independent secrets (all plain hex — safe for compose/systemd/bash).
ensure POSTGRES_PASSWORD "$(openssl rand -hex 16)"
ensure JWT_SECRET "$(openssl rand -hex 20)"                 # 40 hex chars
ensure DASHBOARD_USERNAME "qaadmin"
ensure DASHBOARD_PASSWORD "$(openssl rand -hex 16)"
ensure SECRET_KEY_BASE "$(openssl rand -hex 32)"            # 64 chars (min 64)
ensure REALTIME_DB_ENC_KEY "$(openssl rand -hex 8)"         # exactly 16 chars
ensure PG_META_CRYPTO_KEY "$(openssl rand -hex 16)"         # 32 chars (min 32)
ensure S3_PROTOCOL_ACCESS_KEY_ID "$(openssl rand -hex 16)"
ensure S3_PROTOCOL_ACCESS_KEY_SECRET "$(openssl rand -hex 32)"
ensure ENCRYPTION_KEY "$(openssl rand -hex 32)"             # openssl rand -hex 32
# Inert DSN: valid syntax, unresolvable host — SDK boots, nothing is sent.
ensure SENTRY_DSN "https://qa0000000000000000000000000000000@qa.invalid/1"
ensure BULL_BOARD_USER "qaadmin"
ensure BULL_BOARD_PASSWORD "$(openssl rand -hex 12)"        # 24 chars (min 12)

# JWTs signed with the (possibly just-generated) JWT_SECRET.
JWT_SECRET_VAL="$(get_var JWT_SECRET)"
ensure ANON_KEY "$(mint_jwt anon)"
ensure SERVICE_ROLE_KEY "$(mint_jwt service_role)"

# Aliases — must mirror the canonical values above.
ensure NEXT_PUBLIC_SUPABASE_ANON_KEY "$(get_var ANON_KEY)"
ensure SUPABASE_SERVICE_KEY "$(get_var SERVICE_ROLE_KEY)"
ensure SUPABASE_SERVICE_ROLE_KEY "$(get_var SERVICE_ROLE_KEY)"
ensure SUPABASE_DB_PASSWORD "$(get_var POSTGRES_PASSWORD)"

echo "Done."
echo
echo "REMINDER: OPENROUTER_API_KEY is an external key and was NOT generated."
echo "          Edit $TARGET and set it manually before starting the agents."
echo "Run '${BASH_SOURCE[0]} $TARGET --verify' to validate the result."
