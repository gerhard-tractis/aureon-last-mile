import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// DispatchTrack webhook `status` field (number) → delivery_attempt_status_enum
// Source: https://webhooks-lastmile.dispatchtrack.com/
// 1 = Pending (skip — not terminal)
// 2 = Success
// 3 = Rejected
// 4 = Partial delivery (treated as success)
const STATUS_MAP: Record<number, { status: 'success' | 'failed' | 'returned'; failure_reason: string | null }> = {
  2: { status: 'success', failure_reason: null },
  3: { status: 'failed', failure_reason: 'Rejected' },
  4: { status: 'success', failure_reason: null },
};

// Musan operator_id (hardcoded — single operator account)
const MUSAN_OPERATOR_ID = '92dc5797-047d-458d-bbdb-63f18c0dd1e7';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Validate shared secret to ensure the request is from DispatchTrack
  const secret = Deno.env.get('BEETRACK_WEBHOOK_SECRET');
  if (secret) {
    const incoming = req.headers.get('X-Webhook-Secret') ?? req.headers.get('x-webhook-secret');
    if (incoming !== secret) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  // Log FULL payload for ALL resource types (temporary — schema discovery for Epic 3B)
  console.log(`beetrack-webhook: FULL PAYLOAD resource=${body.resource} →`, JSON.stringify(body));

  // Only process dispatch events — skip route, review, dispatch_guide
  const resource = body.resource as string | undefined;
  if (resource !== 'dispatch') {
    console.log(`beetrack-webhook: skipping resource=${resource}`);
    return new Response(JSON.stringify({ ok: true, skipped: `resource: ${resource}` }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const identifier = body.identifier as string | undefined;
  const status = body.status as number | undefined;
  const arrivedAt = body.arrived_at as string | undefined;
  const substatus = body.substatus as string | undefined;

  if (!identifier) {
    console.warn('beetrack-webhook: missing identifier, skipping');
    return new Response(JSON.stringify({ ok: true, skipped: 'no identifier' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Skip non-terminal statuses (1 = Pending)
  const mapped = status !== undefined ? STATUS_MAP[status] : undefined;
  if (!mapped) {
    console.log(`beetrack-webhook: skipping non-terminal status=${status} for identifier=${identifier}`);
    return new Response(JSON.stringify({ ok: true, skipped: `non-terminal status: ${status}` }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Look up order_id by order_number (identifier)
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id')
    .eq('order_number', identifier)
    .eq('operator_id', MUSAN_OPERATOR_ID)
    .maybeSingle();

  if (orderError) {
    console.error('beetrack-webhook: order lookup failed', orderError);
    return new Response(JSON.stringify({ ok: false, error: orderError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!order) {
    console.warn(`beetrack-webhook: order not found for identifier=${identifier}, skipping`);
    return new Response(JSON.stringify({ ok: true, skipped: `order not found: ${identifier}` }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Use substatus as failure_reason when available for failed deliveries
  const failure_reason = mapped.status !== 'success' && substatus
    ? substatus
    : mapped.failure_reason;

  const attempt = {
    operator_id: MUSAN_OPERATOR_ID,
    order_id: order.id,
    attempt_number: 1,
    status: mapped.status,
    failure_reason,
    attempted_at: arrivedAt ?? new Date().toISOString(),
    driver_id: null,
  };

  const { error: upsertError } = await supabase
    .from('delivery_attempts')
    .upsert(attempt, {
      onConflict: 'operator_id,order_id,attempt_number',
      ignoreDuplicates: false,
    });

  if (upsertError) {
    console.error('beetrack-webhook: upsert failed', upsertError);
    return new Response(JSON.stringify({ ok: false, error: upsertError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  console.log(`beetrack-webhook: upserted delivery_attempt for order=${identifier} status=${mapped.status}`);
  return new Response(JSON.stringify({ ok: true, order_id: order.id, status: mapped.status }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
