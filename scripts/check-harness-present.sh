#!/usr/bin/env bash
# Falla si el harness de orquestación no está donde el runtime lo busca.
#
# Por qué existe: el 2026-09-07 los tres subagentes (implementer, reviewer,
# qa-e2e) desaparecieron a mitad de sesión. La causa no fue un borrado
# malicioso ni un bug del runtime: existían SÓLO como archivos sin trackear en
# un checkout 106 commits por detrás de main. Nada los protegía —
# `git restore` no recupera lo que no está trackeado, un worktree nuevo no los
# hereda, y el runtime, que escanea el directorio de trabajo, simplemente dejó
# de ofrecerlos. El orquestador se quedó sin a quién delegar y siguió
# implementando él mismo, que es exactamente lo que el modelo existe para
# evitar.
#
# Este guard no puede impedir que alguien borre archivos de su disco. Lo que sí
# impide es que un PR los saque del repo: mientras estén trackeados y CI lo
# verifique, cualquier checkout limpio los recupera con `git restore`.
#
# Uso:
#   check-harness-present.sh          verifica el repo actual
set -uo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)" || exit 1

FAILED=0

# Los tres agentes del flujo determinista: implementar → revisar → cerrar.
# Si se añade uno nuevo, va aquí: un agente que el flujo usa pero que nadie
# verifica es el mismo agujero otra vez.
REQUIRED_AGENTS="implementer reviewer qa-e2e"
REQUIRED_HOOKS="keep-going.sh resume-check.sh"

for a in $REQUIRED_AGENTS; do
  f=".claude/agents/${a}.md"

  if [ ! -f "$f" ]; then
    echo "::error::Falta $f. Los tres agentes del flujo (implementer, reviewer, qa-e2e) deben estar trackeados: sin ellos el orquestador no tiene a quién delegar."
    FAILED=1
    continue
  fi

  # Trackeado, no sólo presente. Un archivo sin trackear en el working tree
  # engaña a este check y desaparece igual — que es literalmente lo que pasó.
  if ! git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    echo "::error file=$f::$f existe pero NO está trackeado por git. Así es como se perdieron los agentes el 2026-09-07."
    FAILED=1
  fi

  # El runtime resuelve el agente por el `name:` del frontmatter, no por el
  # nombre del archivo. Si divergen, el agente existe y aun así no se puede
  # invocar por el nombre que el flujo usa.
  if ! grep -qE "^name: ${a}$" "$f"; then
    echo "::error file=$f::El frontmatter debe declarar exactamente 'name: ${a}' — el runtime resuelve por ese campo, no por el nombre del archivo."
    FAILED=1
  fi

  if ! grep -qE '^description: .' "$f"; then
    echo "::error file=$f::Falta 'description:' en el frontmatter. Sin ella el orquestador no sabe cuándo delegar en este agente."
    FAILED=1
  fi
done

for h in $REQUIRED_HOOKS; do
  f=".claude/hooks/${h}"
  if [ ! -f "$f" ]; then
    echo "::error::Falta $f."
    FAILED=1
  elif ! git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    echo "::error file=$f::$f no está trackeado por git."
    FAILED=1
  fi
done

# settings.json registra los hooks. Sin él los hooks existen y no disparan.
if [ ! -f ".claude/settings.json" ]; then
  echo "::error::Falta .claude/settings.json — registra los hooks Stop y SessionStart. Sin él los scripts existen y nunca corren."
  FAILED=1
elif ! git ls-files --error-unmatch ".claude/settings.json" >/dev/null 2>&1; then
  echo "::error file=.claude/settings.json::No está trackeado por git."
  FAILED=1
fi

if [ "$FAILED" -eq 0 ]; then
  echo "check-harness-present: ok"
  exit 0
fi
exit 1
