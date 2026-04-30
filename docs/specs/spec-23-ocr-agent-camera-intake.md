# Spec-23: OCR Agent + Camera Intake Multi-Photo

**Status:** completed

> Architecture: `docs/architecture/agents.md`
> Related: spec-10d (INTAKE agent), spec-20 (cascading dropdowns)
> Provider decisions: OpenRouter for all LLM calls, `google/gemini-2.5-flash` for vision OCR

_Date: 2026-03-29_

---

## Goal

Replace the self-hosted GLM-OCR approach with an OpenRouter vision model (`google/gemini-2.5-flash`) that extracts structured order + package data from multi-page manifest photos in a single API call. Rename `generators` table to `pickup_points` for clarity. Add multi-photo capture flow to the frontend.

## Context

- The VPS has 8GB RAM, 2 CPU cores, no GPU -- not enough for vLLM/GLM-OCR self-hosting
- No hosted GLM-OCR API exists
- OpenRouter is already the project's LLM provider (`@ai-sdk/openai` + OpenRouter base URL)
- Gemini 2.5 Flash has excellent OCR on printed documents, handles multiple images natively, costs ~$0.01-0.02 per submission
- Current `GlmOcrProvider` and two-step process (OCR extract -> Groq reasoning) is replaced by a single vision model call

## Prerequisites

- spec-20 (cascading dropdowns) -- completed
- `intake_submissions` table -- exists
- `orders` and `packages` tables -- exist
- OpenRouter API key configured

---

## 1. Rename `generators` to `pickup_points`

### Migration

```sql
-- Rename table
ALTER TABLE generators RENAME TO pickup_points;

-- Rename indexes
ALTER INDEX idx_generators_operator_id RENAME TO idx_pickup_points_operator_id;
ALTER INDEX idx_generators_tenant_client_id RENAME TO idx_pickup_points_tenant_client_id;

-- Rename constraints (check actual constraint names in DB)
-- ALTER TABLE pickup_points RENAME CONSTRAINT ... TO ...;

-- Rename RLS policies
-- (policy names reference "generators" -- rename to "pickup_points")

-- Rename columns referencing generators
ALTER TABLE intake_submissions RENAME COLUMN generator_id TO pickup_point_id;
ALTER INDEX idx_intake_submissions_generator_id RENAME TO idx_intake_submissions_pickup_point_id;
ALTER TABLE orders RENAME COLUMN generator_id TO pickup_point_id;
ALTER INDEX idx_orders_generator_id RENAME TO idx_orders_pickup_point_id;
ALTER TABLE exceptions RENAME COLUMN generator_id TO pickup_point_id;

-- Note: PostgreSQL updates FK references automatically when the target table is renamed (tracked by OID).
```

### Code changes

| Location | Change |
|----------|--------|
| `useGeneratorsByClient` hook | Rename to `usePickupPointsByClient`, update table reference |
| `CameraIntake.tsx` | Update all `generator`/`generatorId` references to `pickupPoint`/`pickupPointId` |
| `useCameraIntake.ts` | Update `generatorId` param to `pickupPointId` |
| `intake-agent.ts` | Update references |
| `intake-tools.ts` | Update tool descriptions and parameters |
| `tools/supabase/orders.ts` | Update `generator_id` references to `pickup_point_id` |
| `provider-registry.ts` | Remove `getGlmOcr()` and GLM OCR config |
| `provider-registry.test.ts` | Remove GLM OCR tests |
| `exceptions` table references | Update `generator_id` to `pickup_point_id` in any code |
| All test files | Update accordingly |
| `agents-data-model.sql` | Rename ~6 `generators`/`generator_id` references to `pickup_points`/`pickup_point_id` |
| `docs/architecture/agents.md` | Update system diagram, secrets table (remove GLM_OCR_API_KEY, add OPENROUTER_API_KEY), remove GLM-OCR references |
| `apps/mobile/app/(app)/intake.tsx` | Rename `Generator` type, `generators` state, `.from('generators')` query, `generator_id` in insert |
| i18n keys | `pickup.select_pickup_point` already exists, verify others |

---

## 2. Database changes

### Add `OCR` to imported_via enum

```sql
ALTER TYPE imported_via_enum ADD VALUE 'OCR';
```

Note: `orders.pickup_point_id` already exists after the rename in Section 1 (was `generator_id`). No new column needed.

### intake_submissions raw_payload shape change

Old shape (single file):
```json
{ "storage_path": "manifests/op/gen/123-photo.jpg", "file_name": "photo.jpg" }
```

New shape (multi-file):
```json
{ "storage_paths": ["manifests/op/pp/123/page-1.jpg", "manifests/op/pp/123/page-2.jpg"], "file_count": 2 }
```

---

## 3. Frontend -- Multi-photo capture

### Flow

```
1. Select Client -> Select Pickup Point (existing cascading dropdowns)
2. Tap "Tomar foto" -> camera opens -> take photo -> preview
3. Photo added to local array, shown as thumbnail strip with page numbers
4. Prompt: "Agregar otra pagina?" -> [Si, tomar otra] [No, enviar]
5. If "Si" -> camera opens again -> repeat from step 3
6. If "No, enviar" -> upload all photos -> create submission -> show processing state
```

### CameraIntake.tsx changes

- New state: `photos: File[]` array instead of single file
- Thumbnail strip showing captured pages (page 1, 2, 3...) with X to remove
- Two action buttons: "Tomar otra pagina" / "Enviar manifiesto"
- Upload progress: "Subiendo foto 2 de 5..."
- Storage path pattern: `{operatorId}/{pickupPointId}/{timestamp}/page-{N}.jpg`

### useCameraIntake.ts changes

- `submit(files: File[], pickupPointId: string)` instead of `submit(file: File, generatorId: string)`
- Upload photos sequentially (mobile connections may be slow -- parallel uploads of large images can timeout)
- Collect storage paths array
- Insert `intake_submissions` row with `channel: 'mobile_camera'`, `{ storage_paths, file_count }` payload, capture returned `id`
- Realtime subscription: filter on `id=eq.${submissionId}` (not just `operator_id`) for precise targeting
- Max 10 photos per submission (enforced in UI -- disable "Tomar otra" button at limit)

---

## 4. Backend -- INTAKE agent rewrite

### Architecture

```
BullMQ job (intake.ingest) received
  -> INTAKE agent picks up job
  -> Download all images from Supabase Storage -> base64
  -> Single OpenRouter API call:
       Model: google/gemini-2.5-flash
       Input: all images + structured extraction prompt
       Output: JSON with orders[] and packages[]
  -> Validate response with Zod schemas
  -> Insert into orders table (with pickup_point_id, imported_via: 'OCR')
  -> Insert into packages table (linked to order_id)
  -> Update intake_submissions status -> 'parsed'
  -> Realtime fires -> mobile shows result
```

### OpenRouter vision call

Replace `GlmOcrProvider` with a direct OpenRouter call using `@ai-sdk/openai` (new dependency: add to `apps/agents/package.json`).

The vision call lives as a standalone tool function (`tools/ocr/extract-manifest.ts`) rather than going through the `LLMProvider` abstraction, because `LLMProvider` only supports text messages -- not multimodal image content. This is acceptable: the vision call is a tool, not an agent reasoning step.

Replace `GlmOcrProvider` with a direct OpenRouter call:

```typescript
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';

const openrouter = createOpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
});

const result = await generateText({
  model: openrouter('google/gemini-2.5-flash'),
  messages: [{
    role: 'user',
    content: [
      // One image part per page
      ...imageBuffers.map(buf => ({
        type: 'image' as const,
        image: buf,
      })),
      {
        type: 'text' as const,
        text: EXTRACTION_PROMPT,
      },
    ],
  }],
});
```

### Extraction prompt

```
Eres un sistema de extraccion de datos logisticos chilenos.

Analiza todas las paginas de este manifiesto de entrega y extrae cada orden con sus bultos.

Responde UNICAMENTE con JSON valido en este formato exacto:
{
  "delivery_date": "YYYY-MM-DD (fecha de entrega del manifiesto, o null si no aparece)",
  "orders": [{
    "order_number": "string (numero de orden/guia del manifiesto)",
    "customer_name": "string (nombre del destinatario)",
    "customer_phone": "string (telefono, formato chileno)",
    "delivery_address": "string (direccion completa de entrega)",
    "comuna": "string (comuna de entrega)",
    "packages": [{
      "label": "string (codigo de barra o etiqueta del bulto)",
      "package_number": "string o null",
      "declared_box_count": "number (cantidad de cajas, default 1)",
      "sku_items": [{"sku": "string", "description": "string", "quantity": "number"}],
      "declared_weight_kg": "number o null"
    }]
  }]
}

Reglas:
- Extrae TODAS las ordenes visibles en todas las paginas
- Si un campo no es visible o legible, usa null
- Los numeros de telefono chilenos: +56 9 XXXX XXXX
- No inventes datos que no esten en el manifiesto
- Si el manifiesto es ilegible, responde: {"orders": [], "error": "ilegible"}
```

### Zod validation schemas

All fields that are NOT NULL in the `orders` table must be required strings (not nullable).
If the model returns null for a required field, the order is flagged `needs_review` instead of inserted.

```typescript
const PackageSchema = z.object({
  label: z.string(),
  package_number: z.string().nullable(),
  declared_box_count: z.number().default(1),
  sku_items: z.array(z.object({
    sku: z.string(),
    description: z.string(),
    quantity: z.number(),
  })).default([]),
  declared_weight_kg: z.number().nullable(),
});

// Nullable versions for OCR extraction -- model may not read every field
const ExtractedOrderSchema = z.object({
  order_number: z.string(),
  customer_name: z.string().nullable(),
  customer_phone: z.string().nullable(),
  delivery_address: z.string().nullable(),
  comuna: z.string().nullable(),
  packages: z.array(PackageSchema).default([]),
});

const ExtractionResult = z.object({
  delivery_date: z.string().nullable(), // YYYY-MM-DD from manifest header, or null -> defaults to today
  orders: z.array(ExtractedOrderSchema),
  error: z.string().optional(),
});
```

### Required field validation

After Zod parsing, each order is checked for NOT NULL fields: `order_number`, `customer_name`, `customer_phone`, `delivery_address`, `comuna`. If any required field is null:
- The order is still inserted with `status: 'needs_review'` and placeholder values (empty string)
- The `intake_submissions` final status becomes `needs_review` instead of `parsed`
- The operator sees these orders flagged for manual completion in the dashboard

### Deduplication

The `orders` table has a UNIQUE constraint on `(operator_id, order_number)`. Before inserting, check if the order already exists:
- If `order_number` already exists for this operator -> skip, log as duplicate
- This handles re-photographed manifests gracefully

### Insert logic

For each extracted order:
1. Insert into `orders` with:
   - `operator_id` from job context
   - `pickup_point_id` from `intake_submissions` row
   - `delivery_date` from extraction result or current date
   - `imported_via: 'OCR'`
   - `imported_at: now()`
   - `raw_data`: the raw extracted JSON for this order
   - `metadata: {}`
2. Insert each package into `packages` with:
   - `operator_id` from job context
   - `order_id` from the just-inserted order
   - `raw_data`: the raw extracted JSON for this package
3. Update `intake_submissions`:
   - `status: 'parsed'`
   - `orders_created: orders.length`
   - `parsed_data`: full extraction result JSON
   - `processed_by_agent: 'INTAKE'`
   - `processing_completed_at: now()`

### Fallback

- OpenRouter API failure -> mark submission as `needs_review`, log event
- Extraction returns `{"orders": [], "error": "ilegible"}` -> mark as `needs_review`
- Zod validation fails -> mark as `needs_review`, store raw response in `parsed_data` for debugging

---

## 5. Cleanup

| Remove | Reason |
|--------|--------|
| `GlmOcrProvider` class (`providers/glm-ocr.ts`) | Replaced by OpenRouter vision call |
| `GlmOcrProvider` tests (`providers/glm-ocr.test.ts`) | No longer needed |
| `GLM_OCR_API_KEY` from config.ts | No longer needed |
| `GLM_OCR_API_KEY` from agents.md secrets table | No longer needed |
| `extractDocument` tool (`tools/ocr/extract-document.ts`) | Rewritten as part of INTAKE agent |
| `extractDocument` tests | Replaced by new tests |

---

## 6. Files affected

### New dependency
- `@ai-sdk/openai` in `apps/agents/package.json` (for OpenRouter-compatible API)

### New files
- Migration: `YYYYMMDD_rename_generators_pickup_points.sql`
- Migration: `YYYYMMDD_add_ocr_enum.sql`
- `src/tools/ocr/extract-manifest.ts` -- new OpenRouter vision extraction tool
- `src/tools/ocr/extract-manifest.test.ts`

### Modified files (frontend)
- `src/hooks/pickup/useGeneratorsByClient.ts` -> rename to `usePickupPointsByClient.ts`
- `src/hooks/pickup/useGeneratorsByClient.test.ts` -> rename
- `src/hooks/pickup/useCameraIntake.ts` -- multi-photo support
- `src/hooks/pickup/useCameraIntake.test.ts`
- `src/components/pickup/CameraIntake.tsx` -- multi-photo UI + rename references
- `src/components/pickup/CameraIntake.test.tsx`

### Modified files (mobile)
- `apps/mobile/app/(app)/intake.tsx` -- rename Generator type/state/queries to PickupPoint, channel: 'mobile_camera'

### Modified files (agents)
- `src/agents/intake/intake-agent.ts` -- rewrite for OpenRouter vision
- `src/agents/intake/intake-agent.test.ts`
- `src/agents/intake/intake-tools.ts` -- simplify tools
- `src/agents/intake/intake-tools.test.ts`
- `src/config.ts` -- remove GLM_OCR_API_KEY, add OPENROUTER_API_KEY
- `src/providers/provider-registry.ts` -- remove GLM OCR provider registration
- `src/providers/provider-registry.test.ts`
- `src/tools/supabase/orders.ts` -- rename generator_id references
- `docs/architecture/agents.md` -- update system diagram, secrets table, remove GLM-OCR references

### Removed files
- `src/providers/glm-ocr.ts`
- `src/providers/glm-ocr.test.ts`
- `src/tools/ocr/extract-document.ts`
- `src/tools/ocr/extract-document.test.ts`

---

## Exit criteria

- [ ] `generators` table renamed to `pickup_points` everywhere (DB, code, tests, docs)
- [ ] `orders.pickup_point_id` column exists (renamed from `generator_id`) and is populated by camera intake
- [ ] `imported_via: 'OCR'` works for camera-created orders
- [ ] Multi-photo capture: take 3+ photos, see thumbnail strip, remove one, submit rest
- [ ] Max 10 photos enforced in UI
- [ ] Upload progress shown per photo (sequential upload)
- [ ] OpenRouter vision call extracts orders from 4-5 page manifest photos
- [ ] Extracted data validates against Zod schemas
- [ ] Orders and packages inserted correctly with all required fields
- [ ] Orders with missing required fields inserted as `needs_review` with placeholders
- [ ] Duplicate order numbers (same operator) skipped gracefully
- [ ] `intake_submissions` status lifecycle: received -> parsing -> parsed (or needs_review)
- [ ] Realtime subscription filters on submission ID (not just operator_id)
- [ ] Realtime update fires and mobile shows success with order count
- [ ] Fallback: OpenRouter down -> submission marked `needs_review`
- [ ] Fallback: illegible manifest -> submission marked `needs_review`
- [ ] `GlmOcrProvider` and related files removed
- [ ] `docs/architecture/agents.md` updated (no more GLM-OCR references)
- [ ] `operator_id` enforced on every query
- [ ] All files under 300 lines with collocated tests

---
---

# Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace GLM-OCR with OpenRouter Gemini 2.5 Flash vision, rename generators to pickup_points, add multi-photo camera intake.

**Architecture:** Single OpenRouter vision API call processes all manifest photos and returns structured JSON. Frontend collects multiple photos before submission. Database rename from generators to pickup_points for clarity.

**Tech Stack:** TypeScript, Vercel AI SDK (`ai` + `@ai-sdk/openai`), Supabase (Postgres + Storage + Realtime), React, Zod, Vitest

---

## Chunk 1: Database Migrations + Agent Cleanup

### Task 1: Database migration — rename generators to pickup_points

**Files:**
- Create: `packages/database/supabase/migrations/20260329000001_rename_generators_to_pickup_points.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 20260329000001_rename_generators_to_pickup_points.sql
-- Renames generators table to pickup_points and updates all FK columns.

-- 1. Rename the table
ALTER TABLE public.generators RENAME TO pickup_points;

-- 2. Rename table-level indexes
ALTER INDEX IF EXISTS idx_generators_operator_id RENAME TO idx_pickup_points_operator_id;
ALTER INDEX IF EXISTS idx_generators_tenant_client_id RENAME TO idx_pickup_points_tenant_client_id;

-- 3. Rename RLS policies (DROP + CREATE because ALTER POLICY only changes USING/WITH CHECK)
DO $$
BEGIN
  -- Service role policy
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pickup_points' AND policyname = 'generators_service_role') THEN
    DROP POLICY generators_service_role ON public.pickup_points;
    CREATE POLICY pickup_points_service_role ON public.pickup_points FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  -- Authenticated read policy
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pickup_points' AND policyname = 'generators_tenant_read') THEN
    DROP POLICY generators_tenant_read ON public.pickup_points;
    CREATE POLICY pickup_points_tenant_read ON public.pickup_points FOR SELECT TO authenticated
      USING (operator_id = public.get_operator_id());
  END IF;
END $$;

-- 4. Rename FK columns on referencing tables
ALTER TABLE public.intake_submissions RENAME COLUMN generator_id TO pickup_point_id;
ALTER INDEX IF EXISTS idx_intake_submissions_generator_id RENAME TO idx_intake_submissions_pickup_point_id;

ALTER TABLE public.orders RENAME COLUMN generator_id TO pickup_point_id;
ALTER INDEX IF EXISTS idx_orders_generator_id RENAME TO idx_orders_pickup_point_id;

ALTER TABLE public.exceptions RENAME COLUMN generator_id TO pickup_point_id;

-- 5. Update trigger function name if it references generators
ALTER TRIGGER IF EXISTS set_generators_updated_at ON public.pickup_points RENAME TO set_pickup_points_updated_at;

-- Note: FK constraints auto-follow the table rename (PostgreSQL tracks by OID).
```

- [ ] **Step 2: Apply the migration locally**

Run: `cd packages/database && npx supabase db push --local` (or however migrations are applied locally)
Expected: Migration applies without errors.

- [ ] **Step 3: Verify the rename in Supabase**

Run: `npx supabase db lint` or query the local DB to confirm `pickup_points` table exists and `generators` does not.

- [ ] **Step 4: Commit**

```bash
git add packages/database/supabase/migrations/20260329000001_rename_generators_to_pickup_points.sql
git commit -m "chore(db): rename generators table to pickup_points"
```

---

### Task 2: Database migration — add OCR to imported_via_enum

**Files:**
- Create: `packages/database/supabase/migrations/20260329000002_add_ocr_imported_via.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 20260329000002_add_ocr_imported_via.sql
-- Adds 'OCR' value to the imported_via_enum type.

ALTER TYPE public.imported_via_enum ADD VALUE IF NOT EXISTS 'OCR';
```

- [ ] **Step 2: Apply the migration locally**

Run: `cd packages/database && npx supabase db push --local`
Expected: Migration applies without errors.

- [ ] **Step 3: Commit**

```bash
git add packages/database/supabase/migrations/20260329000002_add_ocr_imported_via.sql
git commit -m "chore(db): add OCR to imported_via_enum"
```

---

### Task 3: Agent config — remove GLM-OCR, add OpenRouter

**Files:**
- Modify: `apps/agents/src/config.ts`
- Modify: `apps/agents/src/config.test.ts`
- Modify: `apps/agents/package.json`

- [ ] **Step 1: Update config.ts — remove GLM, add OpenRouter**

In `apps/agents/src/config.ts`, replace the config schema:

```typescript
// src/config.ts — Env var validation using Zod. Exports typed Config singleton.
import { z } from 'zod';

const configSchema = z.object({
  // Required vars
  SUPABASE_URL: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  REDIS_URL: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  GROQ_API_KEY: z.string().min(1),
  OPENROUTER_API_KEY: z.string().min(1),
  ENCRYPTION_KEY: z.string().min(1),
  SENTRY_DSN: z.string().min(1),

  // Optional vars
  BETTERSTACK_HEARTBEAT_URL: z.string().optional(),
  WA_PHONE_NUMBER_ID: z.string().optional(),
  WA_ACCESS_TOKEN: z.string().optional(),
  WA_VERIFY_TOKEN: z.string().optional(),
  WA_APP_SECRET: z.string().optional(),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues
      .map((issue) => issue.path.join('.'))
      .join(', ');
    throw new Error(`Missing required environment variables: ${missing}`);
  }
  return result.data;
}

// Singleton — populated once at startup when this module is first imported
// with the full environment present. Tests use loadConfig() directly.
let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

// Export as `config` alias for convenience; callers import { config } and
// rely on the module being initialised with env vars already set.
export const config: Config = (() => {
  try {
    return loadConfig();
  } catch {
    // During test runs modules are reset and env may not be set.
    // Tests call loadConfig() directly; don't crash at import time.
    return null as unknown as Config;
  }
})();
```

- [ ] **Step 2: Update config.test.ts — replace GLM tests with OpenRouter tests**

In `apps/agents/src/config.test.ts`, find all references to `GLM_OCR_API_KEY` and `GLM_OCR_ENDPOINT` and replace with `OPENROUTER_API_KEY`. The test env object should include `OPENROUTER_API_KEY: 'test-openrouter-key'` instead of the two GLM vars.

- [ ] **Step 3: Run config tests**

Run: `cd apps/agents && npx vitest run src/config.test.ts`
Expected: All tests pass.

- [ ] **Step 4: Add @ai-sdk/openai dependency**

Run: `cd apps/agents && npm install @ai-sdk/openai`

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/config.ts apps/agents/src/config.test.ts apps/agents/package.json apps/agents/package-lock.json
git commit -m "feat(agents): replace GLM-OCR config with OpenRouter, add @ai-sdk/openai"
```

---

### Task 4: Remove GLM-OCR provider and old extract-document tool

**Files:**
- Delete: `apps/agents/src/providers/glm-ocr.ts`
- Delete: `apps/agents/src/providers/glm-ocr.test.ts`
- Delete: `apps/agents/src/tools/ocr/extract-document.ts`
- Delete: `apps/agents/src/tools/ocr/extract-document.test.ts`
- Modify: `apps/agents/src/providers/provider-registry.ts`
- Modify: `apps/agents/src/providers/provider-registry.test.ts`

- [ ] **Step 1: Update provider-registry.ts — remove GLM-OCR**

Replace `apps/agents/src/providers/provider-registry.ts` with:

```typescript
// src/providers/provider-registry.ts — Model name -> provider resolution

import { ClaudeProvider } from './claude';
import { GroqProvider } from './groq';
import type { LLMProvider } from './types';

export interface ProviderRegistryConfig {
  anthropicApiKey: string;
  groqApiKey: string;
}

export class ProviderRegistry {
  private readonly config: ProviderRegistryConfig;
  private readonly cache = new Map<string, LLMProvider>();

  constructor(config: ProviderRegistryConfig) {
    this.config = config;
  }

  /**
   * Resolve a model name in the format "provider:model-name" to an LLMProvider.
   * Supported prefixes: "groq", "claude".
   */
  getProvider(modelName: string): LLMProvider {
    if (this.cache.has(modelName)) {
      return this.cache.get(modelName)!;
    }

    const colonIndex = modelName.indexOf(':');
    if (colonIndex === -1) {
      throw new Error(`Unknown provider prefix in model name: "${modelName}"`);
    }

    const prefix = modelName.slice(0, colonIndex);
    const model = modelName.slice(colonIndex + 1);

    let provider: LLMProvider;
    switch (prefix) {
      case 'groq':
        provider = new GroqProvider(this.config.groqApiKey, model);
        break;
      case 'claude':
        provider = new ClaudeProvider(this.config.anthropicApiKey, model);
        break;
      default:
        throw new Error(`Unknown provider prefix in model name: "${modelName}"`);
    }

    this.cache.set(modelName, provider);
    return provider;
  }
}

export function createProviderRegistry(
  config: ProviderRegistryConfig,
): ProviderRegistry {
  return new ProviderRegistry(config);
}
```

- [ ] **Step 2: Update provider-registry.test.ts — remove GLM-OCR tests**

Remove all test cases that reference `getGlmOcr`, `glmOcrApiKey`, `glmOcrEndpoint`. Update the config object passed to `createProviderRegistry` to only include `anthropicApiKey` and `groqApiKey`.

- [ ] **Step 3: Delete GLM-OCR files**

```bash
rm apps/agents/src/providers/glm-ocr.ts
rm apps/agents/src/providers/glm-ocr.test.ts
rm apps/agents/src/tools/ocr/extract-document.ts
rm apps/agents/src/tools/ocr/extract-document.test.ts
```

- [ ] **Step 4: Run all provider tests**

Run: `cd apps/agents && npx vitest run src/providers/`
Expected: All tests pass. No import errors from removed files.

- [ ] **Step 5: Commit**

```bash
git add -A apps/agents/src/providers/ apps/agents/src/tools/ocr/
git commit -m "refactor(agents): remove GlmOcrProvider and extract-document tool"
```

---

### Task 5: Update orders tool — rename generator_id to pickup_point_id

**Files:**
- Modify: `apps/agents/src/tools/supabase/orders.ts`

- [ ] **Step 1: Update OrderInsert interface**

In `apps/agents/src/tools/supabase/orders.ts`, rename `generator_id` to `pickup_point_id`:

```typescript
// src/tools/supabase/orders.ts — Order CRUD tool
import type { SupabaseClient } from '@supabase/supabase-js';

export interface OrderInsert {
  operator_id: string;
  intake_submission_id: string;
  customer_name: string;
  delivery_address: string;
  customer_id?: string;
  pickup_point_id?: string;
  phone?: string | null;
  notes?: string | null;
  priority?: number;
  agent_metadata?: Record<string, unknown>;
}

export interface OrderRow {
  id: string;
  [key: string]: unknown;
}

export async function upsertOrder(db: SupabaseClient, order: OrderInsert): Promise<OrderRow> {
  const { data, error } = await db
    .from('orders')
    .upsert({ ...order, status: 'pending' })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as OrderRow;
}

export async function updateOrderStatus(
  db: SupabaseClient,
  orderId: string,
  operatorId: string,
  status: string,
): Promise<void> {
  const { error } = await db
    .from('orders')
    .update({ status })
    .eq('id', orderId)
    .eq('operator_id', operatorId)
    .select()
    .single();

  if (error) throw new Error(error.message);
}
```

- [ ] **Step 2: Run tests**

Run: `cd apps/agents && npx vitest run src/tools/supabase/`
Expected: Tests pass (if any reference `generator_id`, update them too).

- [ ] **Step 3: Commit**

```bash
git add apps/agents/src/tools/supabase/orders.ts
git commit -m "refactor(agents): rename generator_id to pickup_point_id in orders tool"
```

---

## Chunk 2: New OCR extraction tool

### Task 6: Create extract-manifest tool with Zod schemas

**Files:**
- Create: `apps/agents/src/tools/ocr/extract-manifest.ts`
- Create: `apps/agents/src/tools/ocr/extract-manifest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/agents/src/tools/ocr/extract-manifest.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { extractManifest, ExtractionResult, EXTRACTION_PROMPT } from './extract-manifest';

// Mock @ai-sdk/openai and ai
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => vi.fn(() => 'mock-model')),
}));

vi.mock('ai', () => ({
  generateText: vi.fn(),
}));

import { generateText } from 'ai';

const mockGenerateText = vi.mocked(generateText);

describe('extractManifest', () => {
  const apiKey = 'test-openrouter-key';

  it('extracts orders from valid JSON response', async () => {
    const mockResponse = {
      delivery_date: '2026-03-29',
      orders: [
        {
          order_number: 'GU-001',
          customer_name: 'Juan Perez',
          customer_phone: '+56 9 1234 5678',
          delivery_address: 'Av. Providencia 1234',
          comuna: 'Providencia',
          packages: [
            {
              label: 'PKG-001',
              package_number: null,
              declared_box_count: 1,
              sku_items: [{ sku: 'SKU1', description: 'Caja A', quantity: 2 }],
              declared_weight_kg: 5.5,
            },
          ],
        },
      ],
    };

    mockGenerateText.mockResolvedValue({
      text: JSON.stringify(mockResponse),
    } as never);

    const result = await extractManifest(apiKey, [Buffer.from('fake-image')]);
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].order_number).toBe('GU-001');
    expect(result.orders[0].packages).toHaveLength(1);
    expect(result.delivery_date).toBe('2026-03-29');
  });

  it('returns error for illegible manifest', async () => {
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({ orders: [], error: 'ilegible' }),
    } as never);

    const result = await extractManifest(apiKey, [Buffer.from('blurry')]);
    expect(result.orders).toHaveLength(0);
    expect(result.error).toBe('ilegible');
  });

  it('handles nullable fields in extraction', async () => {
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({
        delivery_date: null,
        orders: [{
          order_number: 'GU-002',
          customer_name: null,
          customer_phone: null,
          delivery_address: null,
          comuna: null,
          packages: [],
        }],
      }),
    } as never);

    const result = await extractManifest(apiKey, [Buffer.from('partial')]);
    expect(result.orders[0].customer_name).toBeNull();
    expect(result.delivery_date).toBeNull();
  });

  it('throws on invalid JSON response', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'not json at all',
    } as never);

    await expect(extractManifest(apiKey, [Buffer.from('bad')])).rejects.toThrow();
  });

  it('sends all images in one API call', async () => {
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({ delivery_date: null, orders: [] }),
    } as never);

    const images = [Buffer.from('page1'), Buffer.from('page2'), Buffer.from('page3')];
    await extractManifest(apiKey, images);

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    const call = mockGenerateText.mock.calls[0][0] as { messages: Array<{ content: unknown[] }> };
    // 3 images + 1 text = 4 content parts
    expect(call.messages[0].content).toHaveLength(4);
  });

  it('includes extraction prompt', () => {
    expect(EXTRACTION_PROMPT).toContain('JSON valido');
    expect(EXTRACTION_PROMPT).toContain('order_number');
    expect(EXTRACTION_PROMPT).toContain('delivery_date');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/agents && npx vitest run src/tools/ocr/extract-manifest.test.ts`
Expected: FAIL — module `./extract-manifest` not found.

- [ ] **Step 3: Write the implementation**

Create `apps/agents/src/tools/ocr/extract-manifest.ts`:

```typescript
// src/tools/ocr/extract-manifest.ts — OpenRouter vision OCR for manifest photos
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { z } from 'zod';

export const EXTRACTION_PROMPT = `Eres un sistema de extraccion de datos logisticos chilenos.

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

const PackageSchema = z.object({
  label: z.string(),
  package_number: z.string().nullable().default(null),
  declared_box_count: z.number().default(1),
  sku_items: z
    .array(z.object({ sku: z.string(), description: z.string(), quantity: z.number() }))
    .default([]),
  declared_weight_kg: z.number().nullable().default(null),
});

const ExtractedOrderSchema = z.object({
  order_number: z.string(),
  customer_name: z.string().nullable().default(null),
  customer_phone: z.string().nullable().default(null),
  delivery_address: z.string().nullable().default(null),
  comuna: z.string().nullable().default(null),
  packages: z.array(PackageSchema).default([]),
});

const ExtractionResultSchema = z.object({
  delivery_date: z.string().nullable().default(null),
  orders: z.array(ExtractedOrderSchema),
  error: z.string().optional(),
});

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const MODEL = 'google/gemini-2.5-flash';

export async function extractManifest(
  apiKey: string,
  imageBuffers: Buffer[],
): Promise<ExtractionResult> {
  const openrouter = createOpenAI({ apiKey, baseURL: OPENROUTER_BASE_URL });

  const result = await generateText({
    model: openrouter(MODEL),
    messages: [
      {
        role: 'user',
        content: [
          ...imageBuffers.map((buf) => ({ type: 'image' as const, image: buf })),
          { type: 'text' as const, text: EXTRACTION_PROMPT },
        ],
      },
    ],
  });

  // Strip markdown code fences if the model wraps JSON in ```json ... ```
  let text = result.text.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }

  const parsed = JSON.parse(text);
  return ExtractionResultSchema.parse(parsed);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/agents && npx vitest run src/tools/ocr/extract-manifest.test.ts`
Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/tools/ocr/extract-manifest.ts apps/agents/src/tools/ocr/extract-manifest.test.ts
git commit -m "feat(agents): add extract-manifest tool using OpenRouter Gemini 2.5 Flash"
```

---

## Chunk 3: INTAKE Agent Rewrite

### Task 7: Rewrite intake-agent for OpenRouter vision flow

**Files:**
- Modify: `apps/agents/src/agents/intake/intake-agent.ts`
- Modify: `apps/agents/src/agents/intake/intake-agent.test.ts`
- Modify: `apps/agents/src/agents/intake/intake-tools.ts`
- Modify: `apps/agents/src/agents/intake/intake-tools.test.ts`

- [ ] **Step 1: Write failing tests for new intake agent**

Rewrite `apps/agents/src/agents/intake/intake-agent.test.ts` to test the new flow:
- Downloads images from Supabase Storage
- Calls `extractManifest` with all images
- Inserts orders + packages
- Updates submission status to `parsed`
- Marks `needs_review` on missing required fields
- Skips duplicate orders
- Falls back on API failure

The intake agent no longer uses the LLM tool-calling loop — it orchestrates directly:
1. Read `intake_submissions` row to get `storage_paths`
2. Download images → buffers
3. Call `extractManifest(apiKey, buffers)`
4. Validate + insert orders/packages
5. Update submission

Key test cases:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock extractManifest
vi.mock('../../tools/ocr/extract-manifest', () => ({
  extractManifest: vi.fn(),
}));

import { extractManifest } from '../../tools/ocr/extract-manifest';
import { IntakeAgent } from './intake-agent';

const mockExtract = vi.mocked(extractManifest);

describe('IntakeAgent', () => {
  // ... setup mock db, mock config

  it('processes multi-image submission and creates orders', async () => {
    // Mock: submission has 2 storage_paths
    // Mock: extractManifest returns 2 orders with packages
    // Assert: 2 orders inserted, 3 packages inserted, status = parsed
  });

  it('marks submission needs_review when required fields are null', async () => {
    // Mock: extractManifest returns order with null customer_name
    // Assert: order inserted with empty string placeholder, status = needs_review
  });

  it('skips duplicate order_numbers', async () => {
    // Mock: db.upsert returns unique violation
    // Assert: order skipped, logged, no crash
  });

  it('marks submission needs_review on API failure', async () => {
    // Mock: extractManifest throws
    // Assert: status = needs_review, error stored
  });

  it('marks submission needs_review on illegible manifest', async () => {
    // Mock: extractManifest returns { orders: [], error: 'ilegible' }
    // Assert: status = needs_review
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/agents && npx vitest run src/agents/intake/intake-agent.test.ts`
Expected: FAIL — new test cases fail against old implementation.

- [ ] **Step 3: Rewrite intake-agent.ts**

Replace `apps/agents/src/agents/intake/intake-agent.ts` with the new direct-orchestration approach. The agent no longer extends `BaseAgent` (no LLM tool-calling loop needed). It's a function that:

1. Reads `intake_submissions` row → gets `pickup_point_id` + `raw_payload.storage_paths`
2. Downloads each image from Supabase Storage → Buffer array
3. Calls `extractManifest(openrouterApiKey, buffers)`
4. For each order: check dedup → insert order → insert packages
5. Updates `intake_submissions` status

```typescript
// src/agents/intake/intake-agent.ts — INTAKE agent: multi-photo manifest → OCR → orders
import type { SupabaseClient } from '@supabase/supabase-js';
import { extractManifest, type ExtractionResult } from '../../tools/ocr/extract-manifest';
import { log } from '../../lib/logger';

export interface IntakeJobData {
  submission_id: string;
  operator_id: string;
}

const REQUIRED_ORDER_FIELDS = ['customer_name', 'customer_phone', 'delivery_address', 'comuna'] as const;

export async function processIntakeSubmission(
  db: SupabaseClient,
  openrouterApiKey: string,
  job: IntakeJobData,
): Promise<{ ordersCreated: number; status: 'parsed' | 'needs_review' }> {
  const { submission_id, operator_id } = job;

  // 1. Mark as parsing
  await db
    .from('intake_submissions')
    .update({ status: 'parsing', processing_started_at: new Date().toISOString() })
    .eq('id', submission_id)
    .eq('operator_id', operator_id);

  // 2. Read submission to get storage paths
  const { data: submission, error: fetchErr } = await db
    .from('intake_submissions')
    .select('raw_payload, pickup_point_id')
    .eq('id', submission_id)
    .eq('operator_id', operator_id)
    .single();

  if (fetchErr || !submission) {
    throw new Error(`Submission ${submission_id} not found: ${fetchErr?.message}`);
  }

  const storagePaths: string[] = submission.raw_payload?.storage_paths ?? [];
  const pickupPointId: string | null = submission.pickup_point_id;

  if (storagePaths.length === 0) {
    await markNeedsReview(db, submission_id, operator_id, 'No storage paths in submission');
    return { ordersCreated: 0, status: 'needs_review' };
  }

  // 3. Download all images
  const imageBuffers: Buffer[] = [];
  for (const path of storagePaths) {
    const { data, error } = await db.storage.from('manifests').download(path);
    if (error) {
      log('warn', 'image_download_failed', { submission_id, path, error: error.message });
      continue;
    }
    const arrayBuf = await data.arrayBuffer();
    imageBuffers.push(Buffer.from(arrayBuf));
  }

  if (imageBuffers.length === 0) {
    await markNeedsReview(db, submission_id, operator_id, 'All image downloads failed');
    return { ordersCreated: 0, status: 'needs_review' };
  }

  // 4. Call OpenRouter vision OCR
  let extraction: ExtractionResult;
  try {
    extraction = await extractManifest(openrouterApiKey, imageBuffers);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log('error', 'ocr_extraction_failed', { submission_id, error: msg });
    await markNeedsReview(db, submission_id, operator_id, `OCR failed: ${msg}`);
    return { ordersCreated: 0, status: 'needs_review' };
  }

  // 5. Handle illegible manifest
  if (extraction.error) {
    await markNeedsReview(db, submission_id, operator_id, extraction.error);
    return { ordersCreated: 0, status: 'needs_review' };
  }

  // 6. Insert orders + packages
  const deliveryDate = extraction.delivery_date ?? new Date().toISOString().slice(0, 10);
  let ordersCreated = 0;
  let hasIncompleteOrders = false;

  for (const order of extraction.orders) {
    // Check required fields
    const missingFields = REQUIRED_ORDER_FIELDS.filter((f) => !order[f]);
    if (missingFields.length > 0) hasIncompleteOrders = true;

    // Dedup check
    const { data: existing } = await db
      .from('orders')
      .select('id')
      .eq('operator_id', operator_id)
      .eq('order_number', order.order_number)
      .maybeSingle();

    if (existing) {
      log('info', 'order_duplicate_skipped', { submission_id, order_number: order.order_number });
      continue;
    }

    // Insert order
    const { data: newOrder, error: orderErr } = await db
      .from('orders')
      .insert({
        operator_id,
        order_number: order.order_number,
        customer_name: order.customer_name ?? '',
        customer_phone: order.customer_phone ?? '',
        delivery_address: order.delivery_address ?? '',
        comuna: order.comuna ?? '',
        delivery_date: deliveryDate,
        pickup_point_id: pickupPointId,
        imported_via: 'OCR',
        imported_at: new Date().toISOString(),
        raw_data: order,
        metadata: missingFields.length > 0 ? { needs_review: true, missing_fields: missingFields } : {},
      })
      .select('id')
      .single();

    if (orderErr) {
      log('warn', 'order_insert_failed', { submission_id, order_number: order.order_number, error: orderErr.message });
      continue;
    }

    // Insert packages
    for (const pkg of order.packages) {
      await db.from('packages').insert({
        operator_id,
        order_id: newOrder.id,
        label: pkg.label,
        package_number: pkg.package_number,
        declared_box_count: pkg.declared_box_count,
        sku_items: pkg.sku_items,
        declared_weight_kg: pkg.declared_weight_kg,
        raw_data: pkg,
      });
    }

    ordersCreated++;
  }

  // 7. Update submission
  const finalStatus = hasIncompleteOrders || ordersCreated === 0 ? 'needs_review' : 'parsed';
  await db
    .from('intake_submissions')
    .update({
      status: finalStatus,
      orders_created: ordersCreated,
      parsed_data: extraction,
      processed_by_agent: 'INTAKE',
      processing_completed_at: new Date().toISOString(),
    })
    .eq('id', submission_id)
    .eq('operator_id', operator_id);

  log('info', 'intake_complete', { submission_id, ordersCreated, status: finalStatus });
  return { ordersCreated, status: finalStatus };
}

async function markNeedsReview(
  db: SupabaseClient,
  submissionId: string,
  operatorId: string,
  reason: string,
): Promise<void> {
  await db
    .from('intake_submissions')
    .update({
      status: 'needs_review',
      validation_errors: [{ message: reason }],
      processed_by_agent: 'INTAKE',
      processing_completed_at: new Date().toISOString(),
    })
    .eq('id', submissionId)
    .eq('operator_id', operatorId);
}
```

- [ ] **Step 4: Update intake-tools.ts — simplified (only flag_parsing_error remains)**

Since the agent no longer uses a tool-calling loop, `intake-tools.ts` can be simplified or removed. The `flag_parsing_error` logic is now inline in the agent. Replace `intake-tools.ts` with just schema exports if needed, or delete and update imports.

- [ ] **Step 5: Run tests**

Run: `cd apps/agents && npx vitest run src/agents/intake/`
Expected: All tests pass.

- [ ] **Step 6: Run full agent test suite**

Run: `cd apps/agents && npx vitest run`
Expected: All tests pass. No broken imports.

- [ ] **Step 7: Commit**

```bash
git add apps/agents/src/agents/intake/
git commit -m "feat(agents): rewrite INTAKE agent for OpenRouter vision OCR"
```

---

## Chunk 4: Frontend — Rename + Multi-Photo

### Task 8: Rename useGeneratorsByClient to usePickupPointsByClient

**Files:**
- Rename: `apps/frontend/src/hooks/pickup/useGeneratorsByClient.ts` → `usePickupPointsByClient.ts`
- Rename: `apps/frontend/src/hooks/pickup/useGeneratorsByClient.test.ts` → `usePickupPointsByClient.test.ts`

- [ ] **Step 1: Create usePickupPointsByClient.ts**

Create `apps/frontend/src/hooks/pickup/usePickupPointsByClient.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface PickupPoint {
  id: string;
  name: string;
}

/**
 * usePickupPointsByClient — fetches active pickup points for
 * a given operator + tenant client combination.
 */
export function usePickupPointsByClient(
  operatorId: string | null,
  clientId: string | null
) {
  return useQuery<PickupPoint[]>({
    queryKey: ['pickup_points', operatorId, clientId],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (createSPAClient() as any)
        .from('pickup_points')
        .select('id, name')
        .eq('operator_id', operatorId!)
        .eq('tenant_client_id', clientId!)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name');
      if (error) throw error;
      return (data as PickupPoint[]) ?? [];
    },
    enabled: !!operatorId && !!clientId,
    staleTime: 300_000,
  });
}
```

- [ ] **Step 2: Update test file**

Rename `useGeneratorsByClient.test.ts` → `usePickupPointsByClient.test.ts`. Replace all `generator`/`Generator` references with `pickupPoint`/`PickupPoint`. Update `from('generators')` mock to `from('pickup_points')`. Update import path.

- [ ] **Step 3: Delete old files**

```bash
rm apps/frontend/src/hooks/pickup/useGeneratorsByClient.ts
rm apps/frontend/src/hooks/pickup/useGeneratorsByClient.test.ts
```

- [ ] **Step 4: Run tests**

Run: `cd apps/frontend && npx vitest run src/hooks/pickup/usePickupPointsByClient.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/hooks/pickup/
git commit -m "refactor(frontend): rename useGeneratorsByClient to usePickupPointsByClient"
```

---

### Task 9: Rewrite useCameraIntake for multi-photo + rename

**Files:**
- Modify: `apps/frontend/src/hooks/pickup/useCameraIntake.ts`
- Modify: `apps/frontend/src/hooks/pickup/useCameraIntake.test.ts`

- [ ] **Step 1: Write failing tests for multi-photo**

Add test cases to `useCameraIntake.test.ts`:
- `submit` accepts `File[]` array and `pickupPointId`
- Uploads files sequentially to Storage
- Creates submission with `storage_paths` array and `pickup_point_id`
- Subscribes to Realtime filtered by submission `id`
- Reports upload progress

- [ ] **Step 2: Rewrite useCameraIntake.ts**

```typescript
import { useState, useRef, useCallback } from 'react';
import { createSPAClient } from '@/lib/supabase/client';
import { useOperatorId } from '@/hooks/useOperatorId';

export type IntakeStatus = 'idle' | 'uploading' | 'processing' | 'success' | 'error';

export interface IntakeResult {
  ordersCreated: number;
}

interface UseCameraIntakeReturn {
  status: IntakeStatus;
  result: IntakeResult | null;
  error: string | null;
  uploadProgress: { current: number; total: number } | null;
  submit: (files: File[], pickupPointId: string) => Promise<void>;
  reset: () => void;
}

export function useCameraIntake(): UseCameraIntakeReturn {
  const { operatorId } = useOperatorId();
  const [status, setStatus] = useState<IntakeStatus>('idle');
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const channelRef = useRef<ReturnType<ReturnType<typeof createSPAClient>['channel']> | null>(null);

  const reset = useCallback(() => {
    if (channelRef.current) {
      channelRef.current.unsubscribe?.();
      channelRef.current = null;
    }
    setStatus('idle');
    setResult(null);
    setError(null);
    setUploadProgress(null);
  }, []);

  const submit = useCallback(
    async (files: File[], pickupPointId: string) => {
      if (!operatorId || files.length === 0) return;

      setStatus('uploading');
      setError(null);

      const supabase = createSPAClient();
      const timestamp = Date.now();
      const storagePaths: string[] = [];

      // Upload files sequentially
      for (let i = 0; i < files.length; i++) {
        setUploadProgress({ current: i + 1, total: files.length });
        const path = `${operatorId}/${pickupPointId}/${timestamp}/page-${i + 1}.jpg`;
        const { error: uploadError } = await supabase.storage.from('manifests').upload(path, files[i]);
        if (uploadError) {
          setStatus('error');
          setError(uploadError.message);
          return;
        }
        storagePaths.push(path);
      }

      // Insert intake_submissions row
      const { data: submission, error: insertError } = await (supabase.from as CallableFunction)(
        'intake_submissions',
      )
        .insert({
          operator_id: operatorId,
          pickup_point_id: pickupPointId,
          channel: 'mobile_camera',
          status: 'received',
          raw_payload: { storage_paths: storagePaths, file_count: files.length },
        })
        .select('id')
        .single();

      if (insertError || !submission) {
        setStatus('error');
        setError(insertError?.message ?? 'Failed to create submission');
        return;
      }

      setStatus('processing');
      setUploadProgress(null);

      // Subscribe to Realtime filtered by submission ID
      const channel = supabase
        .channel(`intake:${submission.id}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'intake_submissions',
            filter: `id=eq.${submission.id}`,
          },
          (payload: { new: { status: string; orders_created: number } }) => {
            const { status: newStatus, orders_created } = payload.new;
            if (newStatus === 'parsed' || newStatus === 'needs_review' || newStatus === 'confirmed') {
              setResult({ ordersCreated: orders_created ?? 0 });
              setStatus('success');
            } else if (newStatus === 'failed' || newStatus === 'rejected') {
              setStatus('error');
              setError('El manifiesto no pudo ser procesado');
            }
          },
        )
        .subscribe();

      channelRef.current = channel;
    },
    [operatorId],
  );

  return { status, result, error, uploadProgress, submit, reset };
}
```

- [ ] **Step 3: Run tests**

Run: `cd apps/frontend && npx vitest run src/hooks/pickup/useCameraIntake.test.ts`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/hooks/pickup/useCameraIntake.ts apps/frontend/src/hooks/pickup/useCameraIntake.test.ts
git commit -m "feat(frontend): multi-photo useCameraIntake with sequential upload"
```

---

### Task 10: Rewrite CameraIntake.tsx for multi-photo UI + rename

**Files:**
- Modify: `apps/frontend/src/components/pickup/CameraIntake.tsx`
- Modify: `apps/frontend/src/components/pickup/CameraIntake.test.tsx`

- [ ] **Step 1: Write failing tests for multi-photo UI**

Add test cases:
- Shows thumbnail strip after taking first photo
- "Tomar otra pagina" button opens camera again
- "Enviar manifiesto" button submits all photos
- X button removes a photo from the strip
- Max 10 photos — button disabled at limit
- Upload progress displayed
- Dropdown references `pickup_points` not `generators`

- [ ] **Step 2: Rewrite CameraIntake.tsx**

Key changes:
- Import `usePickupPointsByClient` instead of `useGeneratorsByClient`
- Rename `selectedGeneratorId` → `selectedPickupPointId`
- Rename `generators` / `loadingGenerators` → `pickupPoints` / `loadingPickupPoints`
- Add `photos: File[]` state array
- Add `photoUrls: string[]` state for thumbnail previews (via `URL.createObjectURL`)
- Replace single file input with multi-step capture:
  - After first photo: show thumbnail strip + "Tomar otra pagina" / "Enviar manifiesto" buttons
  - "Tomar otra" re-triggers file input
  - "Enviar" calls `submit(photos, selectedPickupPointId)`
- Show upload progress: "Subiendo foto {current} de {total}..."
- `data-testid="generator-select"` → `data-testid="pickup-point-select"`

- [ ] **Step 3: Run tests**

Run: `cd apps/frontend && npx vitest run src/components/pickup/CameraIntake.test.tsx`
Expected: All tests pass.

- [ ] **Step 4: Run full frontend test suite**

Run: `cd apps/frontend && npx vitest run`
Expected: No broken imports from the rename.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/pickup/CameraIntake.tsx apps/frontend/src/components/pickup/CameraIntake.test.tsx
git commit -m "feat(frontend): multi-photo CameraIntake UI with pickup_points rename"
```

---

## Chunk 5: Mobile + Docs

### Task 11: Rename generators in mobile app

**Files:**
- Modify: `apps/mobile/app/(app)/intake.tsx`

- [ ] **Step 1: Rename all generator references**

In `apps/mobile/app/(app)/intake.tsx`:
- `interface Generator` → `interface PickupPoint`
- `type Step = 'select_generator' | ...` → `'select_pickup_point' | ...`
- `generators` state → `pickupPoints`
- `selectedGenerator` → `selectedPickupPoint`
- `loadingGenerators` → `loadingPickupPoints`
- `loadGenerators` → `loadPickupPoints`
- `.from('generators')` → `.from('pickup_points')`
- `generator_id: selectedGenerator.id` → `pickup_point_id: selectedPickupPoint.id`
- `channel: 'manual'` → `channel: 'mobile_camera'` (fix inconsistency)

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/app/(app)/intake.tsx
git commit -m "refactor(mobile): rename generators to pickup_points in intake"
```

---

### Task 12: Update architecture docs

**Files:**
- Modify: `docs/architecture/agents.md`
- Modify: `docs/architecture/agents-data-model.sql`

- [ ] **Step 1: Update agents.md**

In `docs/architecture/agents.md`:
- Line 34-35: Replace `GLM-OCR` in system diagram with `OpenRouter (Gemini 2.5 Flash)`
- Line 95: Replace `GLM-OCR` with `OpenRouter` in error handling section
- Line 219: Replace `GLM_OCR_API_KEY` with `OPENROUTER_API_KEY` in secrets table
- Line 318: Update `extract-document.ts` → `extract-manifest.ts` with new description
- Lines 331-332: Remove `glm-ocr.ts` and `glm-ocr.test.ts` from file listing
- Line 469: Update ADR-009 description to reflect OpenRouter instead of GLM-OCR

- [ ] **Step 2: Update agents-data-model.sql**

Find-replace `generators` → `pickup_points` and `generator_id` → `pickup_point_id` throughout the file.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/agents.md docs/architecture/agents-data-model.sql
git commit -m "docs: update architecture for OpenRouter OCR + pickup_points rename"
```

---

### Task 13: Final verification

- [ ] **Step 1: Run full test suite**

```bash
cd apps/agents && npx vitest run
cd apps/frontend && npx vitest run
```
Expected: All tests pass in both apps.

- [ ] **Step 2: Type-check both apps**

```bash
cd apps/agents && npx tsc --noEmit
cd apps/frontend && npx tsc --noEmit
```
Expected: No type errors.

- [ ] **Step 3: Grep for any remaining "generator" references**

```bash
grep -ri "generator" apps/agents/src/ apps/frontend/src/ apps/mobile/app/ --include="*.ts" --include="*.tsx" -l
```
Expected: No files (all renamed).

- [ ] **Step 4: Grep for GLM-OCR references**

```bash
grep -ri "glm.ocr\|GLM_OCR\|GlmOcr" apps/agents/src/ -l
```
Expected: No files.

- [ ] **Step 5: Commit any final fixes and push**

```bash
git push origin HEAD
gh pr create --title "feat: spec-23 OCR agent + multi-photo camera intake" --body "..."
gh pr merge --auto --squash
```

---

## Hotfix 2026-04-30 — `manifests` storage bucket missing

When the operator first uploaded a Paris manifest photo through the camera intake, the upload failed with `"Bucket not found"`. Investigation found that `useCameraIntake.ts:55` and `intake-agent.ts:50` both call `storage.from('manifests')`, but no migration ever provisioned the `manifests` bucket — only `files` and `raw-files` existed in production storage.

**Fix:** `packages/database/supabase/migrations/20260430000001_create_manifests_storage_bucket.sql`

- Creates a private `manifests` bucket with a 10 MiB per-file cap and `image/jpeg|png|webp|heic|heif` MIME allowlist.
- Adds four RLS policies on `storage.objects` scoping reads/writes to `(storage.foldername(name))[1]::uuid = public.get_operator_id()` — the upload path is already shaped `<operator_id>/<pickup_point_id>/<ts>/page-N.jpg`, so the first folder segment is the natural tenant key.
- The `service_role` key bypasses RLS, so the intake agent worker keeps full access without changes.

The migration is idempotent (`ON CONFLICT` on the bucket, `DROP POLICY IF EXISTS` before each `CREATE POLICY`).

