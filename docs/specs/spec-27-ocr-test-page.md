# Spec 27 — OCR Test Dev Page

**Status:** ready-for-dev
**Branch:** `feat/spec-27-ocr-test-page`
**Created:** 2026-03-30

---

## Goal

A hidden admin-only web page at `/ocr-test` that lets a developer photograph a manifest, send it to Gemini 2.5 Flash via OpenRouter, and inspect the extracted JSON — without touching the intake queue or database.

---

## Out of scope

- Saving results to the database
- Integration with the intake submission flow
- Navigation link in the sidebar
- Non-admin users

---

## Architecture

### Route guard

The page lives at `app/app/ocr-test/page.tsx` inside the existing auth layout. It checks the current session role and redirects to `/app` if the role is not `admin`. Uses the same `createSSRClient` pattern as other protected pages.

### API route — `POST /api/ocr-test`

Server-side only. Accepts `multipart/form-data` with one or more `images` fields.

**Flow:**
1. Validate `OPENROUTER_API_KEY` is set; return 500 if missing
2. Validate at least one image; return 400 if none
3. Convert each `File` → base64 data URL (`data:<mime>;base64,<b64>`)
4. POST to `https://openrouter.ai/api/v1/chat/completions` with model `google/gemini-2.5-flash`, sending all images + the extraction prompt as a single user message
5. Strip markdown fences from the response text if present
6. Parse and return the JSON; return 502 with `{ error, raw }` if parsing fails

No new npm dependencies. Uses native `fetch` and `Buffer`.

**Extraction prompt:** identical to the one in `apps/agents/src/tools/ocr/extract-manifest.ts`. Because `apps/agents` is a separate package the frontend cannot import, the prompt string must be duplicated in `route.ts` with a comment: `// Keep in sync with apps/agents/src/tools/ocr/extract-manifest.ts`.

### Page — `app/app/ocr-test/page.tsx`

Client component. State machine: `idle → loading → done | error`.

**UI sections (top to bottom):**

| Section | Content |
|---|---|
| Header | `ScanText` icon · "OCR Test" title · "Dev Tool" badge · subtitle |
| Photo strip | Thumbnail grid with remove (×) button per photo; "+" button to add more (hidden when empty) |
| Empty state | Dashed border zone when no photos yet |
| Actions | "Abrir cámara" (idle, no photos) → "Extraer datos" + "Limpiar" (photos present) |
| Loading | Spinner + "Procesando…" on the button |
| Error | Red box with error message |
| Results | Summary bar (order count + delivery date badge) · "Ver JSON" toggle · expandable `OrderCard` list |

**Camera input:** `<input type="file" accept="image/*" capture="environment" multiple={false}>` — one photo per tap (appended to strip). Hidden, triggered by button click.

**OrderCard component:** collapsible. First card open by default. Shows order number, customer name, address, comuna, phone, and package list. Package list in a `bg-surface-raised` container.

**Raw JSON toggle:** shows a `<pre>` block with the full `JSON.stringify(result, null, 2)`.

### Env var

`OPENROUTER_API_KEY` — server-side only (no `NEXT_PUBLIC_` prefix).
- Local: `apps/frontend/.env.local`
- Production: Vercel environment variable (same value as in `apps/agents/.env`)

---

## File structure

```
apps/frontend/
  src/app/
    api/ocr-test/
      route.ts                  ← POST handler
    app/ocr-test/
      page.tsx                  ← Client component (page + OrderCard)
  __tests__/
    api/ocr-test/
      route.test.ts             ← API route unit tests
    app/ocr-test/
      page.test.tsx             ← Component tests
```

---

## Tests

### `route.test.ts`

| # | Scenario | Expected |
|---|---|---|
| 1 | Missing `OPENROUTER_API_KEY` | 500 `{ error: 'OPENROUTER_API_KEY not configured...' }` |
| 2 | No images in form data | 400 `{ error: 'No images provided' }` |
| 3 | OpenRouter returns non-200 | 502 `{ error: 'OpenRouter error 429', detail: '...' }` |
| 4 | OpenRouter returns invalid JSON | 502 `{ error: 'Model returned non-JSON', raw: '...' }` |
| 5 | OpenRouter returns JSON wrapped in markdown fences | 200 with parsed result |
| 6 | Happy path — 1 image, valid JSON response | 200 `ExtractionResult` with correct orders |
| 7 | Happy path — 2 images (multi-page manifest) | 200 with two images sent to OpenRouter |

Mock: `global.fetch` via `vi.stubGlobal('fetch', ...)`.

### `page.test.tsx`

| # | Scenario | Expected |
|---|---|---|
| 1 | Initial render | "Abrir cámara" button visible; no thumbnails; no results |
| 2 | Admin role check — non-admin session | Redirects to `/app` |
| 3 | File selected | Thumbnail appears; "Extraer datos" button appears |
| 4 | Remove photo | Thumbnail removed; back to empty state if last photo |
| 5 | Click "Extraer datos" | Button shows spinner + "Procesando…"; fetch called with FormData |
| 6 | Successful response | Order cards render; summary bar shows count and date |
| 7 | First OrderCard is open by default | Order details visible without click |
| 8 | OrderCard click to collapse/expand | Toggles correctly |
| 9 | "Ver JSON" toggle | Pre block appears/disappears |
| 10 | Error response | Red error box shown; no order cards |
| 11 | "Limpiar" button | Resets to idle; thumbnails cleared |

Mock: `fetch` via `vi.stubGlobal`. Mock role via session mock.

---

## Implementation order (TDD)

1. Write all `route.test.ts` tests → implement `route.ts` until all pass
2. Write all `page.test.tsx` tests → implement `page.tsx` until all pass
3. Run full test suite to confirm no regressions
4. Manual smoke test: navigate to `/ocr-test`, photograph a manifest, verify results
5. Add `OPENROUTER_API_KEY` to Vercel env for production
6. Update `docs/sprint-status.yaml`

---

## Design tokens used

Follows existing design system. Tokens verified against `globals.css`:
- `text-text`, `text-text-secondary`, `text-accent`
- `bg-surface-raised`, `border-border`
- `text-destructive`, `bg-destructive/10`, `border-destructive/30`
- shadcn components: `Button`, `Badge`, `Card`, `CardHeader`, `CardContent`
- Lucide icons: `ScanText`, `Camera`, `X`, `Loader2`, `Trash2`, `ChevronDown`, `ChevronUp`
