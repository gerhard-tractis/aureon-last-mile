// src/dev/simulate-event.ts — POST /dev/simulate-event handler
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  processWismoJob,
  WISMO_DEFAULT_MODEL,
  type WismoProactiveJob,
  type WismoClientJob,
} from '../agents/wismo/wismo-agent';
import { getTestOrderSnapshot } from './snapshot';

// ── Pricing table ─────────────────────────────────────────────────────────────

export const WISMO_MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'meta-llama/llama-3.1-8b-instruct':  { input: 0.02, output: 0.05 },
  'qwen/qwen-2.5-7b-instruct':         { input: 0.04, output: 0.09 },
  'google/gemini-2.5-flash-lite-preview-06-17': { input: 0.10, output: 0.40 },
  'mistralai/ministral-8b':            { input: 0.10, output: 0.10 },
  'google/gemini-2.5-flash':           { input: 0.30, output: 2.50 },
  'openai/gpt-4o-mini':                { input: 0.15, output: 0.60 },
  'meta-llama/llama-3.3-70b-instruct': { input: 0.13, output: 0.40 },
  'qwen/qwen-2.5-72b-instruct':        { input: 0.35, output: 0.40 },
};

// ── Validation schemas ────────────────────────────────────────────────────────

const VALID_EVENT_TYPES = [
  'proactive_early_arrival',
  'proactive_pickup',
  'proactive_eta',
  'proactive_delivered',
  'proactive_failed',
  'client_message',
] as const;

type EventType = typeof VALID_EVENT_TYPES[number];

const requestSchema = z.object({
  order_id: z.string(),
  event_type: z.enum(VALID_EVENT_TYPES, {
    errorMap: () => ({ message: `event_type must be one of: ${VALID_EVENT_TYPES.join(', ')}` }),
  }),
  model: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
});

const eventSchemas: Record<EventType, z.ZodTypeAny> = {
  proactive_early_arrival: z.object({}),
  proactive_pickup:        z.object({}),
  proactive_eta:           z.object({ estimated_at: z.string() }),
  proactive_delivered:     z.object({}),
  proactive_failed:        z.object({ failure_reason: z.string() }),
  client_message:          z.object({ body: z.string() }),
};

// ── Response type ─────────────────────────────────────────────────────────────

export interface SimulateEventResult {
  status: number;
  body: Record<string, unknown>;
}

// ── Helper: fetch latest non-deleted assignment id ────────────────────────────

async function fetchAssignmentId(
  db: SupabaseClient,
  order_id: string,
  operator_id: string,
): Promise<string | undefined> {
  const { data } = await db
    .from('assignments')
    .select('id')
    .eq('order_id', order_id)
    .eq('operator_id', operator_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as Record<string, string> | null)?.id;
}

// ── Helper: compute cost ──────────────────────────────────────────────────────

function computeCost(
  newEvents: unknown[],
  modelUsed: string,
): number {
  const pricing = WISMO_MODEL_PRICING[modelUsed] ?? null;
  if (!pricing) return 0;

  let totalCost = 0;
  for (const evt of newEvents) {
    const row = evt as Record<string, unknown>;
    const meta = row.meta as Record<string, unknown> | undefined;
    if (!meta) continue;
    const inputTokens = typeof meta.inputTokens === 'number' ? meta.inputTokens : 0;
    const outputTokens = typeof meta.outputTokens === 'number' ? meta.outputTokens : 0;
    if (inputTokens === 0 && outputTokens === 0) continue;

    // Use the model from meta if available (agent may have its own model)
    const eventModel = typeof meta.model === 'string' ? meta.model : modelUsed;
    const evtPricing = WISMO_MODEL_PRICING[eventModel] ?? pricing;
    totalCost += (inputTokens * evtPricing.input + outputTokens * evtPricing.output) / 1_000_000;
  }

  return totalCost;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function simulateEvent(
  rawInput: unknown,
  operator_id: string,
  db: SupabaseClient,
): Promise<SimulateEventResult> {
  // 1. Validate top-level request shape
  const parsed = requestSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      status: 400,
      body: { error: parsed.error.errors.map((e) => e.message).join('; ') },
    };
  }

  const { order_id, event_type, model, payload = {} } = parsed.data;

  // 2. Validate event-specific payload
  const payloadResult = eventSchemas[event_type].safeParse(payload);
  if (!payloadResult.success) {
    return {
      status: 400,
      body: {
        error: payloadResult.error.errors.map((e) => e.message).join('; '),
      },
    };
  }

  // 3. Verify order exists and belongs to operator_id
  const { data: orderData, error: orderError } = await db
    .from('orders')
    .select('id, external_id, customer_phone, operator_id')
    .eq('id', order_id)
    .eq('operator_id', operator_id)
    .single();

  if (orderError || !orderData) {
    return { status: 400, body: { error: `Order not found: ${order_id}` } };
  }

  const order = orderData as Record<string, string>;

  // 4. Ensure it's a TEST- order
  if (typeof order.external_id !== 'string' || !order.external_id.startsWith('TEST-')) {
    return {
      status: 403,
      body: { error: `Order ${order_id} is not a test order (external_id must start with TEST-)` },
    };
  }

  // 5. Read pre-execution snapshot
  const preSnapshot = await getTestOrderSnapshot(db, operator_id, order_id);
  const preMessageIds = new Set(
    (preSnapshot.messages as Array<Record<string, unknown>>).map((m) => m.id as string),
  );
  const preEventIds = new Set(
    (preSnapshot.recent_agent_events as Array<Record<string, unknown>>).map((e) => e.id as string),
  );

  // 6. Server-side payload enrichment + build job
  const modelUsed = model ?? WISMO_DEFAULT_MODEL;
  let job: WismoProactiveJob | WismoClientJob;

  if (event_type === 'client_message') {
    const typedPayload = payloadResult.data as { body: string };
    job = {
      type: 'client_message',
      order_id,
      operator_id,
      body: typedPayload.body,
      customer_phone: order.customer_phone,
    };
  } else {
    // Proactive events — fetch assignment_id for types that need it
    let assignment_id: string | undefined;
    const needsAssignment = ['proactive_pickup', 'proactive_delivered', 'proactive_failed'];
    if (needsAssignment.includes(event_type)) {
      assignment_id = await fetchAssignmentId(db, order_id, operator_id);
    }

    switch (event_type) {
      case 'proactive_early_arrival':
        job = { type: 'proactive_early_arrival', order_id, operator_id };
        break;
      case 'proactive_pickup':
        job = { type: 'proactive_pickup', order_id, operator_id, assignment_id };
        break;
      case 'proactive_eta': {
        const typedPayload = payloadResult.data as { estimated_at: string };
        job = { type: 'proactive_eta', order_id, operator_id, estimated_at: typedPayload.estimated_at };
        break;
      }
      case 'proactive_delivered':
        job = { type: 'proactive_delivered', order_id, operator_id, assignment_id };
        break;
      case 'proactive_failed': {
        const typedPayload = payloadResult.data as { failure_reason: string };
        job = { type: 'proactive_failed', order_id, operator_id, assignment_id, failure_reason: typedPayload.failure_reason };
        break;
      }
      default:
        return { status: 400, body: { error: `Unhandled event_type: ${event_type}` } };
    }
  }

  // 7. Run the agent
  await processWismoJob({ payload: job, supabase: db, modelOverride: model, channel: 'mock' });

  // 8. Read post-execution snapshot
  const postSnapshot = await getTestOrderSnapshot(db, operator_id, order_id);

  // 9. Compute diffs
  const newMessages = (postSnapshot.messages as Array<Record<string, unknown>>).filter(
    (m) => !preMessageIds.has(m.id as string),
  );
  const newAgentEvents = (postSnapshot.recent_agent_events as Array<Record<string, unknown>>).filter(
    (e) => !preEventIds.has(e.id as string),
  );

  // 10. Compute cost
  const estimatedCostUsd = computeCost(newAgentEvents, modelUsed);

  return {
    status: 200,
    body: {
      snapshot: postSnapshot,
      new_messages: newMessages,
      new_agent_events: newAgentEvents,
      model_used: modelUsed,
      estimated_cost_usd: estimatedCostUsd,
    },
  };
}
