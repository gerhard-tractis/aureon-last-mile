# Spec-16c: Android Tablet PWA — PWA Polish

**Status:** completed

_Date: 2026-03-24_

---

## Goal

Final polish for production tablet deployment: consolidate PWA manifests, translate ConnectionStatusBanner to Spanish with design tokens, set `lang="es"`, and verify offline scanning on Android Chrome.

## Prerequisites

- Spec-16a (tablet shell) — i18n dictionary, viewport hook

## Out of Scope

- New features — this is polish only
- Desktop visual changes

## Deliverables

### 1. PWA Manifest Consolidation

Two manifest files exist with conflicting values and a dead shortcut (`/app/scan`):
- `public/manifest.json` — `orientation: "portrait"`, `background_color: "#5e6b7b"`
- `src/app/manifest.json` — `orientation: "portrait-primary"`, `background_color: "#ffffff"`, dead shortcuts

**Actions:**
- Delete `public/manifest.json`
- Update `src/app/manifest.json`: `orientation: "any"`, `background_color: "#1e2a3a"`, fix shortcuts to `/app/pickup`, `/app/reception`, `/app/distribution`, `/app/dispatch`
- Next.js App Router serves `src/app/manifest.json` at `/manifest.webmanifest`. Add a rewrite in `next.config.ts` from `/manifest.json` → `/manifest.webmanifest` for backward compatibility.
- Remove `manifest: "/manifest.json"` from root layout metadata (auto-served by App Router)

### 2. ConnectionStatusBanner — Spanish + Design Tokens

**Modify:** `src/components/ConnectionStatusBanner.tsx`

- Replace English strings with `t()` calls: "Sin conexión", "Sincronizando...", "{n} escaneos en cola"
- Replace hardcoded Tailwind colors (`bg-green-500`, `bg-yellow-500`, `bg-gray-400`) with design tokens (`bg-status-success`, `bg-status-warning`, `bg-text-muted`)
- Preserve existing `console.error` logging
- **New:** `src/components/ConnectionStatusBanner.test.tsx` — verify Spanish strings and design token classes

### 3. Root Layout Language

**Modify:** `src/app/layout.tsx`
- Change `<html lang="en">` to `<html lang="es">`

### 4. Offline Verification on Android Tablet

No new code — verification and gap-fixing on a real Android tablet:
- Service worker caches all workflow pages for offline access
- `scan_queue` IndexedDB accepts writes when offline
- Background Sync triggers on reconnection
- Scanner input accepts keystrokes when offline
- ConnectionStatusBanner renders correctly on tablet viewport

## Exit Criteria

- [ ] Single manifest at `/manifest.webmanifest` with correct shortcuts and `orientation: "any"`
- [ ] `/manifest.json` rewrite works for backward compat
- [ ] ConnectionStatusBanner shows Spanish strings with design tokens
- [ ] `<html lang="es">` in root layout
- [ ] PWA installs from Chrome "Add to Home Screen" on Android tablet
- [ ] Offline scanning queues and syncs correctly
- [ ] Desktop sees no visual changes
