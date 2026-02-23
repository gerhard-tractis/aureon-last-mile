# CLAUDE.md

## ⚠️ CRITICAL Rules

**Never modify:** `.claude/settings.local.json`, `.claude/settings.json`, `.claude/keybindings.json`

**Never deploy** to Vercel/Supabase/VPS unless user says "deploy" or "push to production".

**Never push to `main` directly.** Always use a feature branch + PR:
```
git checkout -b feat/my-feature
git push origin feat/my-feature
gh pr create
# CI passes → auto-merges → auto-deploys
```

**Always create a PR immediately after every push** — run `gh pr create` as part of the same step.

**Before any story/deployment work**, read: `apps/frontend/docs/deployment-runbook.md`

## Project

Aureon Last Mile — last-mile logistics management platform.
