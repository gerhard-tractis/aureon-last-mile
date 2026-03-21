// routing.ts — Pure functions for WhatsApp message routing and phone normalization
// These functions have no external dependencies and are testable in any runtime.

export interface RouteInput {
  phone: string;
  isDriver: boolean;
  hasActiveOrder: boolean;
  messageType: string;
  messageText: string;
}

export interface RouteResult {
  queue: string;
  type: string;
  flag?: string;
}

/**
 * Normalize a phone number to E.164 format (+569XXXXXXXX for Chilean numbers).
 * WhatsApp sends numbers without the leading '+'.
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  // Already has country code (10+ digits)
  if (digits.length >= 10) return `+${digits}`;
  // Chilean mobile without country code (9 digits starting with 9)
  if (digits.length === 9 && digits.startsWith('9')) return `+56${digits}`;
  return `+${digits}`;
}

/**
 * Route an inbound WhatsApp message to the correct BullMQ queue.
 *
 * Routing priority:
 * 1. Known driver phone → coord.lifecycle { type: 'driver_message' }
 * 2. Known customer phone with active order → wismo.client { type: 'client_message' }
 * 3. Photo/document + intake hint in text → intake.ingest { type: 'photo_parse' }
 * 4. Default → wismo.client { type: 'client_message', flag: 'unknown' }
 */
export function routeMessage(input: RouteInput): RouteResult {
  const { isDriver, hasActiveOrder, messageType, messageText } = input;

  if (isDriver) {
    return { queue: 'coord.lifecycle', type: 'driver_message' };
  }

  if (hasActiveOrder) {
    return { queue: 'wismo.client', type: 'client_message' };
  }

  const isMedia = messageType === 'image' || messageType === 'document';
  const hasIntakeHint = /\b(reparto|despacho|pedido|hoja|ruta|lista)\b/i.test(messageText);
  if (isMedia && hasIntakeHint) {
    return { queue: 'intake.ingest', type: 'photo_parse' };
  }

  return { queue: 'wismo.client', type: 'client_message', flag: 'unknown' };
}

/**
 * Verify WhatsApp X-Hub-Signature-256 HMAC signature.
 * Uses Web Crypto API — compatible with both Deno and Node.js 18+.
 */
export async function verifyHmacSignature(
  body: string,
  secret: string,
  signature: string,
): Promise<boolean> {
  if (!signature.startsWith('sha256=')) return false;

  const expectedHex = signature.slice(7);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const actualHex = Array.from(new Uint8Array(sigBytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return actualHex === expectedHex;
}
