import { describe, it, expect } from 'vitest';
import {
  validateManifestPhotoFile,
  inferMimeFromFileName,
  MANIFEST_BUCKET_MAX_BYTES,
} from './manifestPhotoValidation';

function makeFile(name: string, type: string, size = 4) {
  return new File([new Uint8Array(size)], name, { type });
}

describe('validateManifestPhotoFile', () => {
  it('accepts a JPEG within the size limit', () => {
    const file = makeFile('sheet.jpg', 'image/jpeg');
    const result = validateManifestPhotoFile(file);
    expect(result.ok).toBe(true);
  });

  it('rejects a file whose mime type is not in the bucket allow-list', () => {
    const file = makeFile('sheet.pdf', 'application/pdf');
    const result = validateManifestPhotoFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/formato no soportado/i);
  });

  it('rejects a file over the 10MiB bucket limit', () => {
    const file = makeFile('sheet.jpg', 'image/jpeg', MANIFEST_BUCKET_MAX_BYTES + 1);
    const result = validateManifestPhotoFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/pesa demasiado/i);
  });

  // Menor, ronda 3 de review del PR #713 — `>` a `>=` sobrevivía: un
  // fichero de exactamente 10485760 bytes, que Supabase SÍ acepta, no debe
  // rechazarse.
  it('accepts a file exactly at the 10MiB bucket limit', () => {
    const file = makeFile('sheet.jpg', 'image/jpeg', MANIFEST_BUCKET_MAX_BYTES);
    const result = validateManifestPhotoFile(file);
    expect(result.ok).toBe(true);
  });

  it('accepts an iOS HEIC photo, which is in the bucket allow-list', () => {
    const file = makeFile('sheet.heic', 'image/heic');
    const result = validateManifestPhotoFile(file);
    expect(result.ok).toBe(true);
  });

  // M-B, ronda 3 de review del PR #713 — varios WebViews de Android
  // entregan `type` vacío para el resultado de `capture`. No hay
  // obturador al que volver en esta rama (sólo existe cuando getUserMedia
  // no está disponible o fue denegado) — rechazar un JPEG real es un
  // callejón sin salida.
  it('accepts a file with an empty type but a recognizable JPEG extension, inferring the mime', () => {
    const file = makeFile('IMG_0001.JPG', '');
    const result = validateManifestPhotoFile(file);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.file.type).toBe('image/jpeg');
  });

  it('rejects a file with an empty type and an unrecognizable extension', () => {
    const file = makeFile('IMG_0001', '');
    const result = validateManifestPhotoFile(file);
    expect(result.ok).toBe(false);
  });

  it('does not repackage a File that already carries a type', () => {
    const file = makeFile('sheet.jpg', 'image/jpeg');
    const result = validateManifestPhotoFile(file);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.file).toBe(file);
  });
});

describe('inferMimeFromFileName', () => {
  it('resolves common extensions to their mime type', () => {
    expect(inferMimeFromFileName('a.jpg')).toBe('image/jpeg');
    expect(inferMimeFromFileName('a.jpeg')).toBe('image/jpeg');
    expect(inferMimeFromFileName('a.png')).toBe('image/png');
    expect(inferMimeFromFileName('a.webp')).toBe('image/webp');
    expect(inferMimeFromFileName('a.heic')).toBe('image/heic');
    expect(inferMimeFromFileName('a.heif')).toBe('image/heif');
  });

  it('is case-insensitive on the extension', () => {
    expect(inferMimeFromFileName('a.JPG')).toBe('image/jpeg');
  });

  it('returns null for an unrecognized or missing extension', () => {
    expect(inferMimeFromFileName('a.pdf')).toBeNull();
    expect(inferMimeFromFileName('noext')).toBeNull();
  });
});
