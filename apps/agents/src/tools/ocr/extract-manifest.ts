// src/tools/ocr/extract-manifest.ts — OpenRouter vision OCR for manifest photos
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { z } from 'zod';

export const EXTRACTION_PROMPT = `Eres un sistema de extraccion de datos logisticos chilenos.

Analiza todas las paginas de este manifiesto de entrega y extrae cada orden con sus bultos.

Responde UNICAMENTE con JSON valido en este formato exacto:
{
  "pickup_point_code": "string o null",
  "pickup_point_name": "string o null",
  "orders": [{
    "order_number": "string",
    "customer_name": "string o null",
    "customer_phone": "string o null",
    "delivery_address": "string o null",
    "comuna": "string o null",
    "delivery_date": "YYYY-MM-DD o null",
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
- pickup_point_code: el identificador numerico o alfanumerico del punto de retiro visible en el encabezado del manifiesto
- pickup_point_name: el nombre del punto de retiro o sucursal visible en el manifiesto
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
  delivery_date: z.string().nullable().default(null),
  packages: z.array(PackageSchema).default([]),
});

const ExtractionResultSchema = z.object({
  pickup_point_code: z.string().nullable().default(null),
  pickup_point_name: z.string().nullable().default(null),
  orders: z.array(ExtractedOrderSchema),
  error: z.string().optional(),
});

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
export type ExtractedOrder = z.infer<typeof ExtractedOrderSchema>;
export type ExtractedPackage = z.infer<typeof PackageSchema>;

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const MODEL = 'google/gemini-2.5-flash';

export async function extractManifest(
  apiKey: string,
  imageBuffers: Buffer[],
): Promise<ExtractionResult> {
  const openrouter = createOpenAI({ apiKey, baseURL: OPENROUTER_BASE_URL });

  const result = await generateText({
    model: openrouter(MODEL),
    maxTokens: 65536,
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
