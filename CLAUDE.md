# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## ⚠️ CRITICAL: Do Not Modify Settings Files

**NEVER modify, edit, or write to these files under any circumstances:**
- `.claude/settings.local.json`
- `.claude/settings.json`
- `.claude/keybindings.json`
- Any file matching `*settings*.json`

These files control Claude's own behavior and permissions. Modifying them can break the Claude CLI tool entirely. If the user reports issues with these files, provide instructions for manual fixes rather than editing them directly.

## ⚠️ CRITICAL: Deployment Rules

**NEVER deploy to Vercel, Supabase, or any production environment unless the user explicitly uses the word "deploy" or "push to production".**

When working with environment variables or configuration:
1. ALWAYS check existing configuration first (`vercel env pull`, `git diff`, etc.)
2. Show the user what's missing/different before making changes
3. Ask for explicit confirmation before modifying production settings
4. After adding env vars, inform the user they need to redeploy (don't do it yourself)

### Vercel Workflow
- `vercel env pull` → Check existing vars first
- Ask user: "Should I add X, Y, Z env vars?"
- Add only after confirmation
- Tell user: "Env vars added. You'll need to redeploy for changes to take effect."
- STOP. Let the user deploy.

**Remember:** "Use Vercel CLI to add env vars" means CHECK and ADD variables only, NOT deploy.

## Project Overview

Aureon Last Mile - Last-mile logistics management platform

[Add project-specific instructions here as development progresses]
