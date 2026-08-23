import type { Json } from '@/lib/types';

/**
 * spec-65 Task 7 — the shape of a `dispatches` row this decoder needs.
 * DispatchTrack sends `substatus` already in Spanish (PR #509 corrected an
 * earlier draft of the spec that assumed a code→label table was needed);
 * this file does no translation, only field extraction and formatting.
 */
export interface DispatchEventSource {
  substatus: string | null;
  substatus_code: string | null;
  raw_data: Json;
}

export interface DecodedEvent {
  motivo: string;
  /** Only set when `motivo` fell back to "sin motivo informado" — see decodeMotivo. */
  motivoCode: string | null;
  /** null when raw_data.attempt is absent — omit, never fabricate. */
  intento: string | null;
  /** null when raw_data.accuracy_m is absent — omit, never fabricate. */
  ubicacion: string | null;
  respaldo: string;
}

function isBlank(value: string | null | undefined): value is null | undefined | '' {
  return value === null || value === undefined || value.trim().length === 0;
}

function readRawField(raw: Json, key: string): unknown {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return (raw as Record<string, unknown>)[key];
  }
  return undefined;
}

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '';
}

export function decodeMotivo(
  dispatch: Pick<DispatchEventSource, 'substatus' | 'substatus_code'>,
): { motivo: string; motivoCode: string | null } {
  if (!isBlank(dispatch.substatus)) {
    // The real thing came through — no need to show the code beside it.
    return { motivo: dispatch.substatus, motivoCode: null };
  }
  // substatus_code can ALSO be an empty string, not just null (verified in QA).
  return {
    motivo: 'sin motivo informado',
    motivoCode: isBlank(dispatch.substatus_code) ? null : dispatch.substatus_code,
  };
}

export function decodeIntento(rawData: Json): string | null {
  const attempt = readRawField(rawData, 'attempt');
  if (!isPresent(attempt)) return null;
  return String(attempt);
}

export function decodeUbicacion(rawData: Json): string | null {
  const accuracy = readRawField(rawData, 'accuracy_m');
  if (!isPresent(accuracy)) return null;
  const n = typeof accuracy === 'number' ? accuracy : Number(accuracy);
  if (Number.isNaN(n)) return null;
  return `a ${n} m de la dirección`;
}

export function decodeRespaldo(rawData: Json): string {
  const hasPhoto = isPresent(readRawField(rawData, 'photo_url'));
  const hasSignature = isPresent(readRawField(rawData, 'signature'));
  return `Foto ${hasPhoto ? 'sí' : 'no'} · firma ${hasSignature ? 'sí' : 'no'}`;
}

export function decodeEvent(dispatch: DispatchEventSource): DecodedEvent {
  const { motivo, motivoCode } = decodeMotivo(dispatch);
  return {
    motivo,
    motivoCode,
    intento: decodeIntento(dispatch.raw_data),
    ubicacion: decodeUbicacion(dispatch.raw_data),
    respaldo: decodeRespaldo(dispatch.raw_data),
  };
}
