#!/usr/bin/env bash
# Tests de scripts/check-harness-present.sh
#
# Corren en un repo git temporal: el script exige que los archivos estén
# TRACKEADOS, así que un directorio suelto no serviría para probarlo — y esa
# distinción (presente vs trackeado) es justamente el fallo que reproduce.
set -uo pipefail
S="$(cd "$(dirname "$0")" && pwd)/check-harness-present.sh"
PASS=0; FAIL=0

newrepo() { # imprime la ruta de un repo con el harness completo y trackeado
  local d; d="$(mktemp -d)"
  git -C "$d" init -q
  git -C "$d" config user.email t@t; git -C "$d" config user.name t
  mkdir -p "$d/.claude/agents" "$d/.claude/hooks"
  for a in implementer reviewer qa-e2e; do
    printf -- '---\nname: %s\ndescription: hace cosas\n---\ncuerpo\n' "$a" > "$d/.claude/agents/$a.md"
  done
  for h in keep-going.sh resume-check.sh; do echo '#!/usr/bin/env bash' > "$d/.claude/hooks/$h"; done
  echo '{}' > "$d/.claude/settings.json"
  git -C "$d" add -A >/dev/null 2>&1
  git -C "$d" commit -qm init >/dev/null 2>&1
  printf '%s' "$d"
}

check() { # $1=nombre $2=esperado $3=repo
  ( cd "$3" && bash "$S" >/dev/null 2>&1 ); local got=$?
  if [ "$got" = "$2" ]; then echo "  ok   $1"; PASS=$((PASS+1))
  else echo "  FAIL $1 (esperaba $2, obtuvo $got)"; FAIL=$((FAIL+1)); fi
}

echo "check-harness-present.sh"

R="$(newrepo)"; check "harness completo pasa" 0 "$R"

R="$(newrepo)"; rm "$R/.claude/agents/reviewer.md"
check "agente borrado falla" 1 "$R"

# El fallo real del 2026-09-07: el archivo existe en el working tree pero no
# está trackeado, así que ningún checkout limpio lo recupera.
R="$(newrepo)"; git -C "$R" rm -q --cached .claude/agents/implementer.md >/dev/null 2>&1
check "agente presente pero sin trackear falla" 1 "$R"

R="$(newrepo)"; sed -i 's/^name: qa-e2e$/name: qa_e2e/' "$R/.claude/agents/qa-e2e.md"
git -C "$R" commit -aqm rename >/dev/null 2>&1
check "name del frontmatter que no coincide falla" 1 "$R"

R="$(newrepo)"; sed -i '/^description:/d' "$R/.claude/agents/reviewer.md"
git -C "$R" commit -aqm nodesc >/dev/null 2>&1
check "agente sin description falla" 1 "$R"

R="$(newrepo)"; rm "$R/.claude/hooks/keep-going.sh"
check "hook borrado falla" 1 "$R"

R="$(newrepo)"; rm "$R/.claude/settings.json"
check "settings.json borrado falla" 1 "$R"

echo
echo "  $PASS ok, $FAIL fail"
[ "$FAIL" -eq 0 ]
