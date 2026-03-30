// src/agents/wismo/wismo-agent.ts — WISMO agent: proactive/reactive customer communication
import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseAgent, type AgentContext } from '../base-agent';
import type { LLMProvider, Message } from '../../providers/types';
import { createWismoTools, roundEtaToWindow, closeSession } from './wismo-tools';
import { createOrGetSession, logSessionMessage, getSessionHistory } from '../../tools/supabase/customer-sessions';
import { sendWhatsAppMessage } from '../../tools/whatsapp/send-message';
import { logAgentEvent } from '../../tools/supabase/events';
import { wismoFallback } from './wismo-fallback';

const MAX_STEPS = 5;

const SYSTEM_PROMPT = `Eres el asistente de seguimiento de pedidos de Aureon Last Mile.
Responde siempre en español chileno, de forma empática y concisa.
Tu operator_id es: {operator_id}.
Tienes acceso a herramientas para consultar el estado del pedido, registrar cambios de fecha,
escalar casos complejos al equipo humano y enviar mensajes al cliente.
Sigue las instrucciones del cliente y actúa de forma proactiva para resolver sus consultas.`;

export interface WismoProactiveJob {
  type: 'proactive_early_arrival' | 'proactive_pickup' | 'proactive_eta' | 'proactive_delivered' | 'proactive_failed';
  order_id: string;
  operator_id: string;
  assignment_id?: string;
  estimated_at?: string;
  failure_reason?: string;
}

export interface WismoClientJob {
  type: 'client_message';
  order_id: string;
  operator_id: string;
  session_id?: string;
  body: string;
  external_message_id?: string;
  customer_phone: string;
  customer_name?: string;
}

export class WismoAgent extends BaseAgent {
  private readonly db: SupabaseClient;
  private readonly waPhoneNumberId: string;
  private readonly waAccessToken: string;

  constructor(
    provider: LLMProvider,
    db: SupabaseClient,
    waPhoneNumberId: string,
    waAccessToken: string,
  ) {
    super('WISMO', provider);
    this.db = db;
    this.waPhoneNumberId = waPhoneNumberId;
    this.waAccessToken = waAccessToken;

    const tools = createWismoTools({ db, waPhoneNumberId, waAccessToken });
    for (const tool of tools) this.registerTool(tool);
  }

  async handleProactive(job: WismoProactiveJob): Promise<void> {
    const ctx: AgentContext = { operator_id: job.operator_id };
    const { data: order } = await this.db
      .from('orders')
      .select('customer_phone, customer_name, order_number, delivery_date')
      .eq('id', job.order_id)
      .eq('operator_id', job.operator_id)
      .maybeSingle();

    if (!order) return;
    const { customer_phone, customer_name, order_number, delivery_date } = order as Record<string, string>;

    const session = await createOrGetSession(this.db, {
      operator_id: job.operator_id, order_id: job.order_id, customer_phone, customer_name,
    });

    const { body, action } = buildProactiveMessage(job, order_number, delivery_date);

    const { external_message_id } = await sendWhatsAppMessage(this.waPhoneNumberId, this.waAccessToken, {
      type: 'text', to: customer_phone, body,
    });

    await logSessionMessage(this.db, {
      operator_id: job.operator_id, session_id: session.id,
      role: 'system', body, external_message_id, wa_status: 'sent', action_taken: action,
    });

    // Record in wismo_notifications
    await this.db.from('wismo_notifications').insert({
      operator_id: job.operator_id, order_id: job.order_id,
      notification_type: PROACTIVE_TYPE_MAP[job.type],
      recipient_phone: customer_phone, recipient_name: customer_name ?? null,
      message_body: body, external_message_id,
      delivery_status: 'sent', triggered_by: 'wismo_agent',
    });

    if (job.type === 'proactive_delivered' || job.type === 'proactive_failed') {
      await closeSession(this.db, session.id, job.operator_id);
    }

    await logAgentEvent(this.db, { operator_id: job.operator_id, agent: 'WISMO', event_type: 'tool_call', meta: { type: job.type, order_id: job.order_id, action } });
  }

  async handleReactive(job: WismoClientJob): Promise<void> {
    const ctx: AgentContext = { operator_id: job.operator_id };

    const session = await createOrGetSession(this.db, {
      operator_id: job.operator_id, order_id: job.order_id,
      customer_phone: job.customer_phone, customer_name: job.customer_name,
    });

    // Log incoming customer message
    await logSessionMessage(this.db, {
      operator_id: job.operator_id, session_id: session.id,
      role: 'user', body: job.body,
      external_message_id: job.external_message_id,
    });

    const history = await getSessionHistory(this.db, session.id, job.operator_id);
    const historyMessages: Message[] = history.map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.body,
    }));

    const userMessage: Message = { role: 'user', content: job.body };
    const systemPrompt = SYSTEM_PROMPT.replace('{operator_id}', job.operator_id);

    await this.execute(
      [...historyMessages, userMessage],
      { ...ctx, job_id: job.session_id },
      { maxSteps: MAX_STEPS, systemPrompt },
    );
  }

  protected async handleFallback(
    _messages: Message[],
    context: AgentContext,
    error: unknown,
  ): Promise<{ content: string }> {
    const { data: session } = await this.db
      .from('customer_sessions')
      .select('customer_phone, order_id')
      .eq('operator_id', context.operator_id)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();

    const fallbackBody = session
      ? await wismoFallback(this.db, this.waPhoneNumberId, this.waAccessToken, {
          operator_id: context.operator_id,
          session_id: context.job_id ?? '',
          customer_phone: (session as Record<string, string>).customer_phone,
          order_id: (session as Record<string, string>).order_id,
          error,
        })
      : 'Lo sentimos, estamos experimentando dificultades. Intenta más tarde.';

    return { content: fallbackBody };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PROACTIVE_TYPE_MAP: Record<WismoProactiveJob['type'], string> = {
  proactive_early_arrival: 'proactive_early_arrival',
  proactive_pickup: 'proactive_pickup_confirmed',
  proactive_eta: 'proactive_eta',
  proactive_delivered: 'proactive_delivered',
  proactive_failed: 'proactive_failed',
};

function buildProactiveMessage(
  job: WismoProactiveJob,
  orderNumber: string,
  deliveryDate: string,
): { body: string; action: string } {
  switch (job.type) {
    case 'proactive_early_arrival': {
      const d = new Date(deliveryDate);
      const opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' };
      const formatted = d.toLocaleDateString('es-CL', opts);
      return {
        body: `¡Hola! Tu pedido N° ${orderNumber} ya está listo para entrega (fecha original: ${formatted}). ¿Puedes recibirlo antes? Responde con una fecha que te acomode.`,
        action: 'early_arrival_offered',
      };
    }
    case 'proactive_pickup':
      return { body: `¡Tu pedido N° ${orderNumber} fue recogido y está en camino al área de distribución!`, action: 'pickup_notified' };
    case 'proactive_eta': {
      const window = job.estimated_at ? roundEtaToWindow(job.estimated_at) : 'a confirmar';
      return { body: `¡Tu pedido N° ${orderNumber} está en camino! Estimamos la entrega ${window}.`, action: 'eta_sent' };
    }
    case 'proactive_delivered':
      return { body: `✅ Tu pedido N° ${orderNumber} fue entregado exitosamente. ¡Gracias por confiar en nosotros!`, action: 'delivered_notified' };
    case 'proactive_failed':
      return { body: `Lo sentimos, no pudimos entregar tu pedido N° ${orderNumber}${job.failure_reason ? ` (${job.failure_reason})` : ''}. Te contactaremos pronto para reprogramar.`, action: 'failed_notified' };
  }
}
