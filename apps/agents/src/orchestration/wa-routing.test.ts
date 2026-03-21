// src/orchestration/wa-routing.test.ts
// Tests for pure WhatsApp routing logic (mirrors supabase/functions/whatsapp-webhook/routing.ts)
// Uses Web Crypto API — available in Vitest (Node.js 18+)
import { describe, it, expect } from 'vitest';
// @ts-ignore — cross-app import; TypeScript rootDir does not apply in Vitest
import { normalizePhone, routeMessage, verifyHmacSignature } from '../../../frontend/supabase/functions/whatsapp-webhook/routing';

describe('normalizePhone', () => {
  it('adds + prefix to a 12-digit number', () => {
    expect(normalizePhone('56912345678')).toBe('+56912345678');
  });

  it('adds Chilean country code to a 9-digit number starting with 9', () => {
    expect(normalizePhone('912345678')).toBe('+56912345678');
  });

  it('strips non-digit characters before normalizing', () => {
    expect(normalizePhone('+56 9 1234 5678')).toBe('+56912345678');
  });
});

describe('routeMessage', () => {
  it('routes a known driver to coord.lifecycle as driver_message', () => {
    const result = routeMessage({
      phone: '+56912345678',
      isDriver: true,
      hasActiveOrder: false,
      messageType: 'text',
      messageText: 'Entregué el pedido',
    });
    expect(result.queue).toBe('coord.lifecycle');
    expect(result.type).toBe('driver_message');
  });

  it('routes a known customer with active order to wismo.client', () => {
    const result = routeMessage({
      phone: '+56987654321',
      isDriver: false,
      hasActiveOrder: true,
      messageType: 'text',
      messageText: '¿Dónde está mi pedido?',
    });
    expect(result.queue).toBe('wismo.client');
    expect(result.type).toBe('client_message');
    expect(result.flag).toBeUndefined();
  });

  it('routes an image with intake keyword to intake.ingest', () => {
    const result = routeMessage({
      phone: '+56911111111',
      isDriver: false,
      hasActiveOrder: false,
      messageType: 'image',
      messageText: 'hoja de reparto',
    });
    expect(result.queue).toBe('intake.ingest');
    expect(result.type).toBe('photo_parse');
  });

  it('routes unknown sender with no context to wismo.client with unknown flag', () => {
    const result = routeMessage({
      phone: '+56922222222',
      isDriver: false,
      hasActiveOrder: false,
      messageType: 'text',
      messageText: 'Hola',
    });
    expect(result.queue).toBe('wismo.client');
    expect(result.type).toBe('client_message');
    expect(result.flag).toBe('unknown');
  });

  it('driver takes priority over active order check', () => {
    const result = routeMessage({
      phone: '+56933333333',
      isDriver: true,
      hasActiveOrder: true,
      messageType: 'text',
      messageText: 'ok',
    });
    expect(result.queue).toBe('coord.lifecycle');
    expect(result.type).toBe('driver_message');
  });
});

describe('verifyHmacSignature', () => {
  it('returns true for a valid HMAC-SHA256 signature', async () => {
    const body = '{"test":"payload"}';
    const secret = 'mysecret';
    // Compute expected signature using Web Crypto
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
    const signature = `sha256=${hex}`;

    const result = await verifyHmacSignature(body, secret, signature);
    expect(result).toBe(true);
  });

  it('returns false for an invalid signature', async () => {
    const result = await verifyHmacSignature('body', 'secret', 'sha256=invalidsig');
    expect(result).toBe(false);
  });

  it('returns false when signature does not start with sha256=', async () => {
    const result = await verifyHmacSignature('body', 'secret', 'md5=somehash');
    expect(result).toBe(false);
  });
});
