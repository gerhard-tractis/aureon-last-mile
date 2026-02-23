# CLAUDE.md

## ⚠️ CRITICAL Rules

**Never modify:** `.claude/settings.local.json`, `.claude/settings.json`, `.claude/keybindings.json`

**Never deploy** to Vercel/Supabase/VPS unless user says "deploy" or "push to production".

**Always create a PR immediately after every push** — run `gh pr create` as part of the same step.

**Never push to `main` directly.** Always use a feature branch + PR:
```
git checkout -b feat/my-feature
git push origin feat/my-feature
gh pr create
gh pr merge --auto --squash
# CI passes → auto-merges → auto-deploys
```


**Never declare a task/review/story done until CI passes and PR is merged.** Always `gh pr checks <N>` and `gh pr view <N> --json state,mergedAt` to confirm before reporting completion.

**Never modify SSH config, UFW firewall rules, or fail2ban on the production VPS.** Current VPS state (187.77.48.107): PermitRootLogin yes, UFW allow 22/tcp (not limit), aureon user has full sudo via sudo group. SSH hardening was attempted and caused lockout — reverted. Do not re-attempt.

**Before any story/deployment work**, read: `apps/frontend/docs/deployment-runbook.md`

## Project

Aureon Last Mile — last-mile logistics management platform.
