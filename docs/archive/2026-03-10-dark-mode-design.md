# Dark Mode Design

**Date:** 2026-03-10
**Status:** Approved

## Goal

Add dark mode support to the Aureon Last Mile dashboard, following system preference by default with a manual override toggle.

## Approach

Class-based dark mode using Tailwind's `darkMode: ["class"]` (already configured). The `.dark` class is applied to `<html>`. CSS variables for dark mode are already defined in `globals.css` under the `.dark` selector.

No new dependencies.

## Architecture

### 1. SSR Flash Prevention — inline script in `layout.tsx`

An inline `<script>` tag in `<head>` runs before React hydrates. It reads `localStorage.getItem('aureon-theme')` and falls back to `window.matchMedia('(prefers-color-scheme: dark)').matches`. If dark, applies `.dark` to `<html>` immediately — preventing any flash of light mode.

### 2. `useTheme` hook — `src/hooks/useTheme.ts`

- Reads localStorage key `aureon-theme` (`'dark'` | `'light'` | `null`)
- Falls back to OS preference via `matchMedia`
- Listens for OS preference changes (updates automatically if user changes OS setting and has no manual override)
- Returns `{ isDark: boolean, toggle: () => void }`
- `toggle()` writes to localStorage and flips the class on `<html>`

### 3. `ThemeToggle` component — `src/components/ThemeToggle.tsx`

- Small icon button using `Sun` / `Moon` from lucide-react
- Calls `toggle()` from `useTheme`
- Placed in `AppLayout.tsx` header right side, before the user dropdown

### 4. `.dark` class placement

Applied to `<html>` (not `<body>`) so it coexists cleanly with the existing per-operator theme class on `<body>`.

## Scope

**In this PR:**
- `useTheme` hook
- `ThemeToggle` component
- SSR flash prevention script in `layout.tsx`
- `ThemeToggle` wired into `AppLayout.tsx` header
- Smoke-test dashboard pages in dark mode

**Out of scope (follow-up):**
- Full audit and fix of hardcoded colors (`bg-slate-700`, `#e6c15c` inline) in admin and other components that won't automatically respond to dark mode

## Files to Change

| File | Change |
|------|--------|
| `src/hooks/useTheme.ts` | New — theme hook |
| `src/components/ThemeToggle.tsx` | New — toggle button component |
| `src/app/layout.tsx` | Add inline script to `<head>` |
| `src/components/AppLayout.tsx` | Add `<ThemeToggle>` before user dropdown |
