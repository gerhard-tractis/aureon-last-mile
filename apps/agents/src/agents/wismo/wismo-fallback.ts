// src/agents/wismo/wismo-fallback.ts — LLM-unavailable fallback for WISMO agent
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendWhatsAppMessage } from '../../tools/whatsapp/send-message';
import { logSessionMessage } from '../../tools/supabase/customer-sessions';
import { log } from '../../lib/logger';

const FALLBACK_STATUS_TEMPLATE = (orderNumber: string, status: string) =>
  `Hola, tu pedido N° ${orderNumber} tiene estado: "${status}". Por favor intenta nuevamente en unos minutos o contacta a nuestro equipo.`;

export async function wismoFallback(
  db: SupabaseClient,
  waPhoneNumberId: string,
  waAccessToken: string,
  params: {
    operator_id: string;
    session_id: string;
    customer_phone: string;
    order_id: string;
    error: unknown;
  },
): Promise<string> {
  const errorMsg = params.error instanceof Error ? params.error.message : String(params.error);
  log('warn', 'wismo_llm_fallback', { operator_id: params.operator_id, session_id: params.session_id, error: errorMsg });

  // Fetch last known order state from DB
  const { data: order } = await db
    .from('orders')
    .select('order_number, status')
    .eq('id', params.order_id)
    .eq('operator_id', params.operator_id)
    .maybeSingle();

  const orderNumber = (order as Record<string, unknown> | null)?.order_number as string ?? 'desconocido';
  const status = (order as Record<string, unknown> | null)?.status as string ?? 'desconocido';
  const body = FALLBACK_STATUS_TEMPLATE(orderNumber, status);

  try {
    await sendWhatsAppMessage(waPhoneNumberId, waAccessToken, {
      type: 'text',
      to: params.customer_phone,
      body,
    });

    await logSessionMessage(db, {
      operator_id: params.operator_id,
      session_id: params.session_id,
      role: 'system',
      body,
      action_taken: 'fallback_status_sent',
    });
  } catch (sendErr) {
    log('error', 'wismo_fallback_send_failed', { error: String(sendErr) });
  }

  return body;
}
