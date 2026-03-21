// src/tools/ocr/extract-document.ts — Download image from Storage and run GLM-OCR
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GlmOcrProvider, GlmOcrResponse } from '../../providers/glm-ocr';

const MANIFEST_PROMPT =
  'Extrae del manifiesto de entrega: nombre empresa, RUT, dirección, teléfono, ' +
  'ítems (descripción, cantidad, peso). Responde en JSON estructurado.';

export async function extractDocument(
  db: SupabaseClient,
  ocr: GlmOcrProvider,
  storagePath: string,
): Promise<GlmOcrResponse> {
  // Parse bucket/path from storagePath (e.g. "manifests/photo.jpg")
  const slashIndex = storagePath.indexOf('/');
  const bucket = slashIndex === -1 ? storagePath : storagePath.slice(0, slashIndex);
  const filePath = slashIndex === -1 ? storagePath : storagePath.slice(slashIndex + 1);

  const { data, error } = await db.storage.from(bucket).download(filePath);
  if (error) throw new Error(error.message);

  const buffer = await data.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');

  return ocr.extractDocument(base64, MANIFEST_PROMPT);
}
