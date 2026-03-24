// src/tools/ocr/extract-document.test.ts
import { describe, it, expect, vi } from 'vitest';
import { extractDocument } from './extract-document';
import type { GlmOcrProvider } from '../../providers/glm-ocr';

function makeOcr(response: { text: string; confidence: number; fields?: Record<string, string> }) {
  return { extractDocument: vi.fn().mockResolvedValue(response) } as unknown as GlmOcrProvider;
}

function makeStorage(base64: string, error: unknown = null) {
  return {
    storage: {
      from: vi.fn().mockReturnValue({
        download: vi.fn().mockResolvedValue({
          data: error ? null : { arrayBuffer: async () => Buffer.from(base64, 'base64') },
          error,
        }),
      }),
    },
  };
}

describe('extractDocument', () => {
  it('downloads image from Supabase Storage', async () => {
    const ocr = makeOcr({ text: 'Invoice #123', confidence: 0.9 });
    const db = makeStorage('aGVsbG8=');
    await extractDocument(db as never, ocr, 'manifests/photo.jpg');
    expect(db.storage.from).toHaveBeenCalledWith('manifests');
  });

  it('calls GLM-OCR with base64 image and manifest prompt', async () => {
    const ocr = makeOcr({ text: 'Destinatario: Juan', confidence: 0.85 });
    const db = makeStorage('aGVsbG8=');
    await extractDocument(db as never, ocr, 'manifests/photo.jpg');
    expect(ocr.extractDocument).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('manifiesto'),
    );
  });

  it('returns structured result with text and confidence', async () => {
    const ocr = makeOcr({ text: 'Easy SpA\nRUT: 76543210-1', confidence: 0.92 });
    const db = makeStorage('aGVsbG8=');
    const result = await extractDocument(db as never, ocr, 'manifests/photo.jpg');
    expect(result.text).toBe('Easy SpA\nRUT: 76543210-1');
    expect(result.confidence).toBe(0.92);
  });

  it('throws when Storage download fails', async () => {
    const ocr = makeOcr({ text: '', confidence: 0 });
    const db = makeStorage('', { message: 'file not found' });
    await expect(extractDocument(db as never, ocr, 'manifests/missing.jpg')).rejects.toThrow(
      'file not found',
    );
  });
});
