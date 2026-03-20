// supabase/functions/whatsapp-webhook/index.ts
// Supabase Edge Function (Deno) — WhatsApp Cloud API inbound webhook
// Verifies HMAC signature, routes inbound messages to agent_commands table
// Returns 200 within 5s (WhatsApp requirement)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyHmacSignature, normalizePhone, routeMessage } from './routing.ts';

const WA_APP_SECRET = Deno.env.get('WA_APP_SECRET') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

Deno.serve(async (req: Request) => {
  // WhatsApp verification handshake (GET)
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === Deno.env.get('WA_VERIFY_TOKEN')) {
      return new Response(challenge, { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const rawBody = await req.text();

  // Verify X-Hub-Signature-256
  const signature = req.headers.get('x-hub-signature-256') ?? '';
  const isValid = await verifyHmacSignature(rawBody, WA_APP_SECRET, signature);
  if (!isValid) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Parse payload
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Process each inbound message entry
  const entries = (body as { entry?: unknown[] }).entry ?? [];
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] }).changes ?? [];
    for (const change of changes) {
      const value = (change as { value?: unknown }).value as Record<string, unknown> | undefined;
      if (!value) continue;

      const messages = (value.messages as unknown[] | undefined) ?? [];
      for (const msg of messages) {
        const message = msg as {
          from?: string;
          type?: string;
          text?: { body?: string };
          id?: string;
        };

        if (!message.from) continue;

        const phone = normalizePhone(message.from);
        const operatorId = await resolveOperatorId(supabase, phone);
        if (!operatorId) continue;

        const { data: drivers } = await supabase
          .from('drivers')
          .select('id, phone')
          .eq('operator_id', operatorId)
          .eq('phone', phone)
          .limit(1);

        const { data: orders } = await supabase
          .from('orders')
          .select('id, customer_phone')
          .eq('operator_id', operatorId)
          .eq('customer_phone', phone)
          .eq('status', 'active')
          .limit(1);

        const route = routeMessage({
          phone,
          isDriver: (drivers ?? []).length > 0,
          hasActiveOrder: (orders ?? []).length > 0,
          messageType: message.type ?? 'text',
          messageText: message.text?.body ?? '',
        });

        await supabase.from('agent_commands').insert({
          operator_id: operatorId,
          command_type: route.type,
          payload: {
            phone,
            messageId: message.id,
            messageType: message.type,
            text: message.text?.body,
            queue: route.queue,
            ...(route.flag ? { flag: route.flag } : {}),
          },
          status: 'pending',
          source: 'whatsapp_webhook',
        });
      }
    }
  }

  // Always return 200 immediately (WhatsApp requires response within 5s)
  return new Response('OK', { status: 200 });
});

async function resolveOperatorId(
  supabase: ReturnType<typeof createClient>,
  _phone: string,
): Promise<string | null> {
  // In production: look up operator by phone number routing config
  // For now: return the single operator (single-tenant bootstrap)
  const { data } = await supabase.from('operators').select('id').limit(1).single();
  return data?.id ?? null;
}
