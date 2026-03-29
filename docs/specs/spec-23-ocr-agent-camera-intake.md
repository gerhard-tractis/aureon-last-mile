# Spec-23: OCR Agent + Camera Intake Multi-Photo

**Status:** backlog

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
   - `delivery_date` from current date (or manifest header if extractable)
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
