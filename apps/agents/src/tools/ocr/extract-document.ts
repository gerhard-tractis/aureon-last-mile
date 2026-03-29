// Stub — replaced by extract-manifest in Task 6. Remove once intake-tools.ts is rewritten.
import type { SupabaseClient } from '@supabase/supabase-js';

export async function extractDocument(
  db: SupabaseClient,
  ocr: { extractDocument: (buf: Buffer) => Promise<unknown> },
  imageUrl: string,
): Promise<unknown> {
  const { data, error } = await db.storage.from('').download(imageUrl);
  if (error || !data) throw new Error(`Storage download failed: ${error?.message ?? 'no data'}`);
  const buf = Buffer.from(await data.arrayBuffer());
  return ocr.extractDocument(buf);
}
