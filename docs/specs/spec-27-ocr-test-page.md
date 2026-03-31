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

---

# Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/ocr-test` admin-only page with camera input, OpenRouter OCR, and results display — TDD throughout.

**Architecture:** Next.js server component guards auth/role, renders a client component. An API route handles multipart upload → OpenRouter call → JSON response. No new npm dependencies.

**Tech Stack:** Next.js 14 App Router, Vitest + @testing-library/react, native fetch, shadcn/ui, Lucide icons.

---

### Task 1: API Route — `POST /api/ocr-test`

**Files:**
- Create: `apps/frontend/src/app/api/ocr-test/route.test.ts`
- Create: `apps/frontend/src/app/api/ocr-test/route.ts`

- [ ] **Step 1.1: Write the failing tests**

Create `apps/frontend/src/app/api/ocr-test/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';

// ── helpers ──────────────────────────────────────────────────────────────────
function makeReq(images: File[] = []): NextRequest {
  const fd = new FormData();
  images.forEach((f) => fd.append('images', f));
  return { formData: vi.fn().mockResolvedValue(fd) } as unknown as NextRequest;
}

function fakeJpeg(name = 'photo.jpg'): File {
  return new File(['fake-image-bytes'], name, { type: 'image/jpeg' });
}

// ── suite ─────────────────────────────────────────────────────────────────────
describe('POST /api/ocr-test', () => {
  const originalKey = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key-123';
  });

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env.OPENROUTER_API_KEY = originalKey;
    } else {
      delete process.env.OPENROUTER_API_KEY;
    }
    vi.unstubAllGlobals();
  });

  it('returns 500 when OPENROUTER_API_KEY is not set', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const res = await POST(makeReq([fakeJpeg()]));
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/OPENROUTER_API_KEY not configured/);
  });

  it('returns 400 when no images are provided', async () => {
    const res = await POST(makeReq([]));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('No images provided');
  });

  it('returns 502 when OpenRouter returns a non-200 status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'Rate limited' }),
    );
    const res = await POST(makeReq([fakeJpeg()]));
    expect(res.status).toBe(502);
    const body = await res.json() as { error: string; detail: string };
    expect(body.error).toMatch(/OpenRouter error 429/);
    expect(body.detail).toBe('Rate limited');
  });

  it('returns 502 when OpenRouter response is not valid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'not-json' } }] }),
      }),
    );
    const res = await POST(makeReq([fakeJpeg()]));
    expect(res.status).toBe(502);
    const body = await res.json() as { error: string; raw: string };
    expect(body.error).toBe('Model returned non-JSON');
    expect(body.raw).toBe('not-json');
  });

  it('strips markdown fences and parses the JSON', async () => {
    const payload = { delivery_date: '2026-03-30', orders: [] };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '```json\n' + JSON.stringify(payload) + '\n```' } }],
        }),
      }),
    );
    const res = await POST(makeReq([fakeJpeg()]));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(payload);
  });

  it('returns 200 with parsed extraction result for a single image', async () => {
    const payload = {
      delivery_date: '2026-03-30',
      orders: [{
        order_number: 'ORD-001',
        customer_name: 'Test Co',
        customer_phone: null,
        delivery_address: 'Av. Test 123',
        comuna: 'Santiago',
        packages: [{ label: 'PKG-1', package_number: null, declared_box_count: 1, sku_items: [], declared_weight_kg: null }],
      }],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
      }),
    );
    const res = await POST(makeReq([fakeJpeg()]));
    expect(res.status).toBe(200);
    const body = await res.json() as typeof payload;
    expect(body.orders).toHaveLength(1);
    expect(body.orders[0].order_number).toBe('ORD-001');
  });

  it('sends both images to OpenRouter for a two-page manifest', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"delivery_date":null,"orders":[]}' } }] }),
    });
    vi.stubGlobal('fetch', mockFetch);
    await POST(makeReq([fakeJpeg('p1.jpg'), fakeJpeg('p2.jpg')]));
    const sentBody = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body) as {
      messages: Array<{ content: Array<{ type: string }> }>;
    };
    const imageItems = sentBody.messages[0].content.filter((c) => c.type === 'image_url');
    expect(imageItems).toHaveLength(2);
  });
});
```

- [ ] **Step 1.2: Run tests — confirm they all fail**

```bash
cd apps/frontend && npx vitest run src/app/api/ocr-test/route.test.ts
```

Expected: 7 failures — `route.ts` does not exist yet.

- [ ] **Step 1.3: Implement `route.ts`**

Create `apps/frontend/src/app/api/ocr-test/route.ts`:

```typescript
// Keep extraction prompt in sync with apps/agents/src/tools/ocr/extract-manifest.ts
import { NextRequest, NextResponse } from 'next/server';

const EXTRACTION_PROMPT = `Eres un sistema de extraccion de datos logisticos chilenos.

Analiza todas las paginas de este manifiesto de entrega y extrae cada orden con sus bultos.

Responde UNICAMENTE con JSON valido en este formato exacto:
{
  "delivery_date": "YYYY-MM-DD o null",
  "orders": [{
    "order_number": "string",
    "customer_name": "string o null",
    "customer_phone": "string o null",
    "delivery_address": "string o null",
    "comuna": "string o null",
    "packages": [{
      "label": "string",
      "package_number": "string o null",
      "declared_box_count": 1,
      "sku_items": [{"sku": "string", "description": "string", "quantity": 1}],
      "declared_weight_kg": null
    }]
  }]
}

Reglas:
- Extrae TODAS las ordenes visibles en todas las paginas
- Si un campo no es visible o legible, usa null
- Los numeros de telefono chilenos: +56 9 XXXX XXXX
- No inventes datos que no esten en el manifiesto
- Si el manifiesto es ilegible, responde: {"orders": [], "error": "ilegible"}`;

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'google/gemini-2.5-flash';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENROUTER_API_KEY not configured on this server' },
      { status: 500 },
    );
  }

  const formData = await req.formData();
  const images = formData.getAll('images').filter((v): v is File => v instanceof File);

  if (images.length === 0) {
    return NextResponse.json({ error: 'No images provided' }, { status: 400 });
  }

  const imageContents = await Promise.all(
    images.map(async (file) => {
      const bytes = await file.arrayBuffer();
      const base64 = Buffer.from(bytes).toString('base64');
      return {
        type: 'image_url' as const,
        image_url: { url: `data:${file.type};base64,${base64}` },
      };
    }),
  );

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'user',
          content: [...imageContents, { type: 'text', text: EXTRACTION_PROMPT }],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    return NextResponse.json(
      { error: `OpenRouter error ${response.status}`, detail: body },
      { status: 502 },
    );
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  let text = data.choices[0]?.message?.content?.trim() ?? '';
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }

  try {
    const result = JSON.parse(text) as unknown;
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: 'Model returned non-JSON', raw: text }, { status: 502 });
  }
}
```

- [ ] **Step 1.4: Run tests — confirm all 7 pass**

```bash
cd apps/frontend && npx vitest run src/app/api/ocr-test/route.test.ts
```

Expected: 7 passed.

- [ ] **Step 1.5: Commit**

```bash
git add apps/frontend/src/app/api/ocr-test/
git commit -m "feat(ocr-test): POST /api/ocr-test — OpenRouter OCR route with tests"
```

---

### Task 2: Server Page + Role Guard

**Files:**
- Create: `apps/frontend/src/app/app/ocr-test/page.test.tsx`
- Create: `apps/frontend/src/app/app/ocr-test/page.tsx`

- [ ] **Step 2.1: Write the failing tests**

Create `apps/frontend/src/app/app/ocr-test/page.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

// ── mocks ─────────────────────────────────────────────────────────────────────
const mockGetSession = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createSSRClient: vi.fn().mockResolvedValue({
    auth: { getSession: mockGetSession },
  }),
}));

const mockRedirect = vi.fn().mockImplementation(() => {
  throw new Error('NEXT_REDIRECT');
});

vi.mock('next/navigation', () => ({ redirect: mockRedirect }));

vi.mock('./OcrTestClient', () => ({
  default: () => <div data-testid="ocr-test-client" />,
}));

import OcrTestPage from './page';

// ── helpers ────────────────────────────────────────────────────────────────────
function sessionWithRole(role: string) {
  return {
    data: {
      session: { user: { app_metadata: { claims: { role } } } },
    },
  };
}

// ── tests ──────────────────────────────────────────────────────────────────────
describe('OcrTestPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to /auth/login when there is no session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    await expect(OcrTestPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(mockRedirect).toHaveBeenCalledWith('/auth/login');
  });

  it('redirects to /app when role is not admin', async () => {
    mockGetSession.mockResolvedValue(sessionWithRole('operator'));
    await expect(OcrTestPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(mockRedirect).toHaveBeenCalledWith('/app');
  });

  it('renders OcrTestClient when role is admin', async () => {
    mockGetSession.mockResolvedValue(sessionWithRole('admin'));
    const element = await OcrTestPage();
    const { getByTestId } = render(element as React.ReactElement);
    expect(getByTestId('ocr-test-client')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2.2: Run tests — confirm they all fail**

```bash
cd apps/frontend && npx vitest run src/app/app/ocr-test/page.test.tsx
```

Expected: 3 failures — `page.tsx` does not exist yet.

- [ ] **Step 2.3: Implement `page.tsx`**

Create `apps/frontend/src/app/app/ocr-test/page.tsx`:

```typescript
import { redirect } from 'next/navigation';
import { createSSRClient } from '@/lib/supabase/server';
import OcrTestClient from './OcrTestClient';

export default async function OcrTestPage() {
  const supabase = await createSSRClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect('/auth/login');
  }

  const userRole = session.user.app_metadata?.claims?.role as string | undefined;
  if (userRole !== 'admin') {
    redirect('/app');
  }

  return <OcrTestClient />;
}
```

- [ ] **Step 2.4: Run tests — confirm all 3 pass**

```bash
cd apps/frontend && npx vitest run src/app/app/ocr-test/page.test.tsx
```

Expected: 3 passed.

- [ ] **Step 2.5: Commit**

```bash
git add apps/frontend/src/app/app/ocr-test/page.tsx apps/frontend/src/app/app/ocr-test/page.test.tsx
git commit -m "feat(ocr-test): server page with admin role guard"
```

---

### Task 3: Client Component — `OcrTestClient`

**Files:**
- Create: `apps/frontend/src/app/app/ocr-test/OcrTestClient.test.tsx`
- Create: `apps/frontend/src/app/app/ocr-test/OcrTestClient.tsx`

- [ ] **Step 3.1: Write the failing tests**

Create `apps/frontend/src/app/app/ocr-test/OcrTestClient.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';

// ── ui mocks ──────────────────────────────────────────────────────────────────
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled }: React.ComponentProps<'button'>) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <div onClick={onClick}>{children}</div>
  ),
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('lucide-react', () => ({
  Camera: () => <span>Camera</span>,
  X: () => <span>X</span>,
  Loader2: () => <span>Loader2</span>,
  ScanText: () => <span>ScanText</span>,
  Trash2: () => <span>Trash2</span>,
  ChevronDown: () => <span>▼</span>,
  ChevronUp: () => <span>▲</span>,
}));

// ── browser API mocks ─────────────────────────────────────────────────────────
Object.defineProperty(URL, 'createObjectURL', {
  writable: true,
  value: vi.fn().mockReturnValue('blob:fake-url'),
});
Object.defineProperty(URL, 'revokeObjectURL', {
  writable: true,
  value: vi.fn(),
});

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

// ── helpers ───────────────────────────────────────────────────────────────────
import OcrTestClient, { OrderCard } from './OcrTestClient';

function fakeFile(name = 'manifest.jpg'): File {
  return new File(['fake'], name, { type: 'image/jpeg' });
}

function addPhoto(container: HTMLElement, file = fakeFile()) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

const sampleOrder = {
  order_number: 'ORD-001',
  customer_name: 'Empresa Test',
  customer_phone: '+56 9 1234 5678',
  delivery_address: 'Av. Libertador 123',
  comuna: 'Santiago',
  packages: [
    { label: 'PKG-1', package_number: null, declared_box_count: 2, declared_weight_kg: null },
  ],
};

const sampleResult = { delivery_date: '2026-03-30', orders: [sampleOrder] };

// ── OcrTestClient tests ────────────────────────────────────────────────────────
describe('OcrTestClient', () => {
  it('renders header and Abrir cámara button in idle state', () => {
    render(<OcrTestClient />);
    expect(screen.getByText('OCR Test')).toBeInTheDocument();
    expect(screen.getByText('Dev Tool')).toBeInTheDocument();
    expect(screen.getByText('Abrir cámara')).toBeInTheDocument();
    expect(screen.queryByText('Extraer datos')).not.toBeInTheDocument();
  });

  it('shows thumbnail and action buttons after a photo is selected', () => {
    const { container } = render(<OcrTestClient />);
    addPhoto(container);
    expect(screen.getByAltText('Foto 1')).toBeInTheDocument();
    expect(screen.getByText('Extraer datos')).toBeInTheDocument();
    expect(screen.getByText('Limpiar')).toBeInTheDocument();
    expect(screen.queryByText('Abrir cámara')).not.toBeInTheDocument();
  });

  it('removes a thumbnail when the delete button is clicked', () => {
    const { container } = render(<OcrTestClient />);
    addPhoto(container);
    fireEvent.click(screen.getByLabelText('Eliminar foto 1'));
    expect(screen.queryByAltText('Foto 1')).not.toBeInTheDocument();
    expect(screen.getByText('Abrir cámara')).toBeInTheDocument();
  });

  it('calls fetch with FormData containing the image when Extraer datos is clicked', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => sampleResult });
    const { container } = render(<OcrTestClient />);
    addPhoto(container);
    fireEvent.click(screen.getByText('Extraer datos'));
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/ocr-test',
      expect.objectContaining({ method: 'POST' }),
    );
    const { body } = mockFetch.mock.calls[0][1] as { body: FormData };
    expect(body.getAll('images')).toHaveLength(1);
  });

  it('shows order cards and summary bar on successful extraction', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => sampleResult });
    const { container } = render(<OcrTestClient />);
    addPhoto(container);
    fireEvent.click(screen.getByText('Extraer datos'));
    await waitFor(() => expect(screen.getByText(/1 orden encontrada/)).toBeInTheDocument());
    expect(screen.getByText('ORD-001')).toBeInTheDocument();
    expect(screen.getByText('2026-03-30')).toBeInTheDocument();
  });

  it('shows error box and no order cards on a failed extraction', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'OpenRouter error 429', detail: 'Rate limited' }),
    });
    const { container } = render(<OcrTestClient />);
    addPhoto(container);
    fireEvent.click(screen.getByText('Extraer datos'));
    await waitFor(() =>
      expect(screen.getByText('OpenRouter error 429')).toBeInTheDocument(),
    );
    expect(screen.queryByText('ORD-001')).not.toBeInTheDocument();
  });

  it('resets to idle when Limpiar is clicked after a result', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => sampleResult });
    const { container } = render(<OcrTestClient />);
    addPhoto(container);
    fireEvent.click(screen.getByText('Extraer datos'));
    await waitFor(() => screen.getByText('Limpiar'));
    fireEvent.click(screen.getByText('Limpiar'));
    expect(screen.getByText('Abrir cámara')).toBeInTheDocument();
    expect(screen.queryByText('ORD-001')).not.toBeInTheDocument();
  });

  it('toggles the raw JSON block when Ver JSON / Ocultar JSON is clicked', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => sampleResult });
    const { container } = render(<OcrTestClient />);
    addPhoto(container);
    fireEvent.click(screen.getByText('Extraer datos'));
    await waitFor(() => screen.getByText('Ver JSON'));
    expect(screen.queryByText(/"orders"/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Ver JSON'));
    expect(screen.getByText(/"orders"/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Ocultar JSON'));
    expect(screen.queryByText(/"orders"/)).not.toBeInTheDocument();
  });
});

// ── OrderCard tests ────────────────────────────────────────────────────────────
describe('OrderCard', () => {
  it('is expanded by default for the first card (index 0)', () => {
    render(<OrderCard order={sampleOrder} index={0} />);
    expect(screen.getByText('Av. Libertador 123')).toBeInTheDocument();
    expect(screen.getByText('+56 9 1234 5678')).toBeInTheDocument();
  });

  it('is collapsed by default for subsequent cards (index > 0)', () => {
    render(<OrderCard order={sampleOrder} index={1} />);
    expect(screen.queryByText('Av. Libertador 123')).not.toBeInTheDocument();
  });

  it('expands and collapses when the header is clicked', () => {
    render(<OrderCard order={sampleOrder} index={1} />);
    expect(screen.queryByText('Av. Libertador 123')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('ORD-001'));
    expect(screen.getByText('Av. Libertador 123')).toBeInTheDocument();
    fireEvent.click(screen.getByText('ORD-001'));
    expect(screen.queryByText('Av. Libertador 123')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3.2: Run tests — confirm they all fail**

```bash
cd apps/frontend && npx vitest run src/app/app/ocr-test/OcrTestClient.test.tsx
```

Expected: failures — `OcrTestClient.tsx` does not exist yet.

- [ ] **Step 3.3: Implement `OcrTestClient.tsx`**

Create `apps/frontend/src/app/app/ocr-test/OcrTestClient.tsx`:

```typescript
'use client';

import { useState, useRef, useCallback } from 'react';
import { Camera, X, Loader2, ScanText, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

// ── Types ──────────────────────────────────────────────────────────────────────
interface ExtractedPackage {
  label: string;
  package_number: string | null;
  declared_box_count: number;
  declared_weight_kg: number | null;
}

interface ExtractedOrder {
  order_number: string;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  comuna: string | null;
  packages: ExtractedPackage[];
}

interface ExtractionResult {
  delivery_date: string | null;
  orders: ExtractedOrder[];
  error?: string;
}

// ── OrderCard ──────────────────────────────────────────────────────────────────
export function OrderCard({ order, index }: { order: ExtractedOrder; index: number }) {
  const [open, setOpen] = useState(index === 0);

  return (
    <Card className="border border-border">
      <CardHeader
        className="py-3 px-4 cursor-pointer select-none"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-xs">#{index + 1}</Badge>
            <span className="font-semibold text-sm text-text">{order.order_number}</span>
            {order.customer_name && (
              <span className="text-text-secondary text-sm">{order.customer_name}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              {order.packages.length} bulto{order.packages.length !== 1 ? 's' : ''}
            </Badge>
            {open ? (
              <ChevronUp className="size-4 text-text-secondary" />
            ) : (
              <ChevronDown className="size-4 text-text-secondary" />
            )}
          </div>
        </div>
      </CardHeader>

      {open && (
        <CardContent className="pb-4 px-4 pt-0 space-y-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {order.delivery_address && (
              <>
                <span className="text-text-secondary">Dirección</span>
                <span className="text-text">{order.delivery_address}</span>
              </>
            )}
            {order.comuna && (
              <>
                <span className="text-text-secondary">Comuna</span>
                <span className="text-text">{order.comuna}</span>
              </>
            )}
            {order.customer_phone && (
              <>
                <span className="text-text-secondary">Teléfono</span>
                <span className="text-text font-mono">{order.customer_phone}</span>
              </>
            )}
          </div>
          {order.packages.length > 0 && (
            <div className="mt-2 rounded-md bg-surface-raised p-2 space-y-1">
              {order.packages.map((pkg, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-text">{pkg.label}</span>
                  <span className="text-text-secondary">
                    {pkg.declared_box_count} caja{pkg.declared_box_count !== 1 ? 's' : ''}
                    {pkg.declared_weight_kg ? ` · ${pkg.declared_weight_kg} kg` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ── OcrTestClient ──────────────────────────────────────────────────────────────
export default function OcrTestClient() {
  const [photos, setPhotos] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [rawJson, setRawJson] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addPhoto = useCallback((file: File) => {
    setPhotos((prev) => [...prev, file]);
    setPreviews((prev) => [...prev, URL.createObjectURL(file)]);
  }, []);

  const removePhoto = useCallback((idx: number) => {
    setPreviews((prev) => {
      URL.revokeObjectURL(prev[idx]);
      return prev.filter((_, i) => i !== idx);
    });
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const reset = useCallback(() => {
    previews.forEach((url) => URL.revokeObjectURL(url));
    setPhotos([]);
    setPreviews([]);
    setStatus('idle');
    setResult(null);
    setRawJson('');
    setErrorMsg('');
  }, [previews]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) addPhoto(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const runOcr = async () => {
    if (photos.length === 0) return;
    setStatus('loading');
    setResult(null);
    setErrorMsg('');

    const formData = new FormData();
    photos.forEach((f) => formData.append('images', f));

    try {
      const res = await fetch('/api/ocr-test', { method: 'POST', body: formData });
      const json = (await res.json()) as ExtractionResult & { error?: string };
      setRawJson(JSON.stringify(json, null, 2));

      if (!res.ok) {
        setErrorMsg(json.error ?? `HTTP ${res.status}`);
        setStatus('error');
        return;
      }

      setResult(json);
      setStatus('done');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Network error');
      setStatus('error');
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ScanText className="size-6 text-accent" />
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-text">OCR Test</h1>
            <Badge variant="outline" className="text-xs text-text-secondary">Dev Tool</Badge>
          </div>
          <p className="text-sm text-text-secondary">
            Sube fotos de un manifiesto y ve qué extrae Gemini 2.5 Flash
          </p>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Photo strip or empty state */}
      {previews.length > 0 ? (
        <div className="flex gap-2 flex-wrap">
          {previews.map((url, i) => (
            <div key={i} className="relative group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`Foto ${i + 1}`}
                className="h-24 w-20 object-cover rounded-lg border border-border"
              />
              <button
                aria-label={`Eliminar foto ${i + 1}`}
                onClick={() => removePhoto(i)}
                className="absolute -top-1.5 -right-1.5 size-5 rounded-full bg-destructive text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
          <button
            aria-label="Agregar foto"
            onClick={() => fileInputRef.current?.click()}
            className="h-24 w-20 rounded-lg border-2 border-dashed border-border flex items-center justify-center text-text-secondary hover:border-accent hover:text-accent transition-colors"
          >
            <Camera className="size-5" />
          </button>
        </div>
      ) : (
        <div className="rounded-lg border-2 border-dashed border-border p-8 text-center text-text-secondary">
          Sin fotos aún
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        {photos.length === 0 ? (
          <Button onClick={() => fileInputRef.current?.click()} className="gap-2">
            <Camera className="size-4" />
            Abrir cámara
          </Button>
        ) : (
          <>
            <Button onClick={runOcr} disabled={status === 'loading'} className="gap-2">
              {status === 'loading' ? (
                <><Loader2 className="size-4 animate-spin" />Procesando…</>
              ) : (
                <><ScanText className="size-4" />Extraer datos</>
              )}
            </Button>
            <Button variant="ghost" onClick={reset} className="gap-2 text-text-secondary">
              <Trash2 className="size-4" />
              Limpiar
            </Button>
          </>
        )}
      </div>

      {/* Error */}
      {status === 'error' && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
          {errorMsg}
        </div>
      )}

      {/* Results */}
      {status === 'done' && result && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-text">
                {result.orders.length} orden{result.orders.length !== 1 ? 'es' : ''} encontrada
                {result.orders.length !== 1 ? 's' : ''}
              </span>
              {result.delivery_date && (
                <Badge variant="secondary" className="text-xs font-mono">
                  {result.delivery_date}
                </Badge>
              )}
              {result.error && (
                <Badge variant="destructive" className="text-xs">{result.error}</Badge>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-text-secondary"
              onClick={() => setShowRaw((v) => !v)}
            >
              {showRaw ? 'Ocultar JSON' : 'Ver JSON'}
            </Button>
          </div>

          {showRaw && (
            <pre className="rounded-lg bg-surface-raised p-4 text-xs font-mono text-text overflow-auto max-h-80">
              {rawJson}
            </pre>
          )}

          <div className="space-y-3">
            {result.orders.map((order, i) => (
              <OrderCard key={order.order_number} order={order} index={i} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3.4: Run tests — confirm all 10 pass**

```bash
cd apps/frontend && npx vitest run src/app/app/ocr-test/OcrTestClient.test.tsx
```

Expected: 10 passed.

- [ ] **Step 3.5: Run full frontend test suite — confirm no regressions**

```bash
cd apps/frontend && npx vitest run
```

Expected: all existing tests still pass, 20 new tests added.

- [ ] **Step 3.6: Commit**

```bash
git add apps/frontend/src/app/app/ocr-test/
git commit -m "feat(ocr-test): OcrTestClient component with camera, thumbnails, results"
```

---

### Task 4: Env Var, Sprint Status, PR

- [ ] **Step 4.1: Add `OPENROUTER_API_KEY` to the frontend `.env.local`**

Append to `apps/frontend/.env.local` (value from `apps/agents/.env`):

```
# OCR Test dev tool — keep in sync with apps/agents/.env
OPENROUTER_API_KEY=<value from apps/agents/.env>
```

Verify it is already listed in `.gitignore` (`.env.local` is gitignored by default in Next.js).

- [ ] **Step 4.2: Update sprint-status**

In `docs/sprint-status.yaml`, add after the `spec-26*` entries:

```yaml
  spec-27-ocr-test-page: in-progress  # Admin-only /ocr-test page — camera → OpenRouter OCR → results. TDD.
```

- [ ] **Step 4.3: Commit sprint-status**

```bash
git add docs/sprint-status.yaml
git commit -m "chore: mark spec-27 in-progress"
```

- [ ] **Step 4.4: Push and open PR**

```bash
git push origin feat/spec-27-ocr-test-page
gh pr create \
  --title "feat(ocr-test): admin OCR test page at /ocr-test" \
  --body "Closes spec-27. Admin-only page: camera capture → POST /api/ocr-test → Gemini 2.5 Flash → order cards + raw JSON toggle. 20 new tests."
gh pr merge --auto --squash
```

- [ ] **Step 4.5: Monitor CI and confirm merge**

```bash
gh pr checks <PR_NUMBER> --watch
gh pr view <PR_NUMBER> --json state,mergedAt
```

Expected: CI passes, PR merges automatically.

---

## Design tokens used

Follows existing design system. Tokens verified against `globals.css`:
- `text-text`, `text-text-secondary`, `text-accent`
- `bg-surface-raised`, `border-border`
- `text-destructive`, `bg-destructive/10`, `border-destructive/30`
- shadcn components: `Button`, `Badge`, `Card`, `CardHeader`, `CardContent`
- Lucide icons: `ScanText`, `Camera`, `X`, `Loader2`, `Trash2`, `ChevronDown`, `ChevronUp`
