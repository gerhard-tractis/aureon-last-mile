// src/agents/wismo/wismo-tools.ts — Tool definitions + execute functions for WISMO agent
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentTool, AgentContext } from '../base-agent';
import {
  createOrGetSession,
  getSessionHistory,
  logSessionMessage,
  escalateSession,
  closeSession,
} from '../../tools/supabase/customer-sessions';
import { insertReschedule, type RescheduleReason } from '../../tools/supabase/reschedules';
import { sendWhatsAppMessage } from '../../tools/whatsapp/send-message';
import { logAgentEvent } from '../../tools/supabase/events';

export interface WismoToolDeps {
  db: SupabaseClient;
  waPhoneNumberId: string;
  waAccessToken: string;
  channel?: 'whatsapp' | 'mock';
}

// ── ETA utility (private, deterministic — not an LLM-callable tool) ───────────

export function roundEtaToWindow(estimated_at: string): string {
  // estimated_at is HH:mm or ISO datetime string
  const timePart = estimated_at.includes('T')
    ? estimated_at.split('T')[1].slice(0, 5)
    : estimated_at.slice(0, 5);

  const [hStr, mStr] = timePart.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);

  // Round to nearest 30 minutes
  const totalMins = h * 60 + m;
  const rounded = Math.round(totalMins / 30) * 30;
  const rH = Math.floor(rounded / 60) % 24;
  const rM = rounded % 60;

  const earlyMins = rounded - 60;
  const earlyH = Math.floor(((earlyMins % 1440) + 1440) % 1440 / 60);
  const earlyM = ((earlyMins % 60) + 60) % 60;

  const lateH = Math.floor(((rounded + 60) % 1440) / 60);
  const lateM = (rounded + 60) % 60;

  const fmt = (hv: number, mv: number) =>
    `${String(hv).padStart(2, '0')}:${String(mv).padStart(2, '0')}`;

  return `entre las ${fmt(earlyH, earlyM)} y ${fmt(lateH, lateM)}`;
}

// ── Tool factory ──────────────────────────────────────────────────────────────

export function createWismoTools(deps: WismoToolDeps): AgentTool[] {
  const { db, waPhoneNumberId, waAccessToken, channel } = deps;

  const createOrGetSessionTool: AgentTool = {
    name: 'create_or_get_session',
    description: 'Find or create a customer_sessions row for the given order.',
    parameters: {
      type: 'object',
      properties: {
        order_id:       { type: 'string' },
        customer_phone: { type: 'string' },
        customer_name:  { type: 'string' },
      },
      required: ['order_id', 'customer_phone'],
    },
    async execute(args, ctx: AgentContext) {
      const session = await createOrGetSession(db, {
        operator_id: ctx.operator_id,
        order_id: args.order_id as string,
        customer_phone: args.customer_phone as string,
        customer_name: args.customer_name as string | undefined,
      });
      await logAgentEvent(db, { operator_id: ctx.operator_id, agent: 'WISMO', event_type: 'tool_call', job_id: ctx.job_id, meta: { tool: 'create_or_get_session', session_id: session.id } });
      return session;
    },
  };

  const getSessionHistoryTool: AgentTool = {
    name: 'get_session_history',
    description: 'Load all messages in a customer session as agent memory context.',
    parameters: {
      type: 'object',
      properties: { session_id: { type: 'string' } },
      required: ['session_id'],
    },
    async execute(args, ctx: AgentContext) {
      return getSessionHistory(db, args.session_id as string, ctx.operator_id);
    },
  };

  const getOrderStatusTool: AgentTool = {
    name: 'get_order_status',
    description: 'Query current order status, assignment state, and ETA from the database.',
    parameters: {
      type: 'object',
      properties: { order_id: { type: 'string' } },
      required: ['order_id'],
    },
    async execute(args, ctx: AgentContext) {
      const { data, error } = await db
        .from('orders')
        .select(`
          id, order_number, status, delivery_date,
          rescheduled_delivery_date, rescheduled_window_start, rescheduled_window_end,
          assignments!inner(status, estimated_at),
          dispatches(estimated_at)
        `)
        .eq('id', args.order_id as string)
        .eq('operator_id', ctx.operator_id)
        .maybeSingle();

      if (error) throw new Error(`get_order_status: ${error.message}`);
      return data;
    },
  };

  const sendCustomerMessageTool: AgentTool = {
    name: 'send_customer_message',
    description: 'Send a WhatsApp message to the customer and log it as a system message in the session.',
    parameters: {
      type: 'object',
      properties: {
        session_id:     { type: 'string' },
        customer_phone: { type: 'string' },
        body:           { type: 'string' },
        template_name:  { type: 'string' },
        action_taken:   { type: 'string' },
      },
      required: ['session_id', 'customer_phone', 'body'],
    },
    async execute(args, ctx: AgentContext) {
      const { external_message_id } = await sendWhatsAppMessage(waPhoneNumberId, waAccessToken, {
        type: 'text',
        to: args.customer_phone as string,
        body: args.body as string,
      }, channel);

      const msg = await logSessionMessage(db, {
        operator_id: ctx.operator_id,
        session_id: args.session_id as string,
        role: 'system',
        body: args.body as string,
        external_message_id,
        wa_status: 'sent',
        template_name: args.template_name as string | undefined,
        action_taken: args.action_taken as string | undefined,
      });

      await logAgentEvent(db, { operator_id: ctx.operator_id, agent: 'WISMO', event_type: 'tool_call', job_id: ctx.job_id, meta: { tool: 'send_customer_message', session_id: args.session_id, action_taken: args.action_taken } });
      return { message_id: msg.id, external_message_id };
    },
  };

  const captureRescheduleTool: AgentTool = {
    name: 'capture_reschedule',
    description: 'Insert an order_reschedules row and update denormalised fields on the order.',
    parameters: {
      type: 'object',
      properties: {
        order_id:               { type: 'string' },
        reason:                 { type: 'string', enum: ['not_home', 'time_preference', 'address_change', 'early_delivery', 'other'] },
        customer_note:          { type: 'string' },
        requested_date:         { type: 'string' },
        requested_window_start: { type: 'string' },
        requested_window_end:   { type: 'string' },
        requested_address:      { type: 'string' },
        session_message_id:     { type: 'string' },
      },
      required: ['order_id', 'reason'],
    },
    async execute(args, ctx: AgentContext) {
      const reschedule = await insertReschedule(db, {
        operator_id: ctx.operator_id,
        order_id: args.order_id as string,
        reason: args.reason as RescheduleReason,
        customer_note: args.customer_note as string | undefined,
        requested_date: args.requested_date as string | undefined,
        requested_window_start: args.requested_window_start as string | undefined,
        requested_window_end: args.requested_window_end as string | undefined,
        requested_address: args.requested_address as string | undefined,
        session_message_id: args.session_message_id as string | undefined,
      });
      await logAgentEvent(db, { operator_id: ctx.operator_id, agent: 'WISMO', event_type: 'decision', job_id: ctx.job_id, meta: { tool: 'capture_reschedule', reschedule_id: reschedule.id, reason: reschedule.reason } });
      return reschedule;
    },
  };

  const escalateToHumanTool: AgentTool = {
    name: 'escalate_to_human',
    description: 'Mark the session as escalated and alert the operator dashboard.',
    parameters: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        reason:     { type: 'string' },
      },
      required: ['session_id', 'reason'],
    },
    async execute(args, ctx: AgentContext) {
      await escalateSession(db, args.session_id as string, ctx.operator_id);
      await logAgentEvent(db, { operator_id: ctx.operator_id, agent: 'WISMO', event_type: 'decision', job_id: ctx.job_id, meta: { tool: 'escalate_to_human', session_id: args.session_id, reason: args.reason } });
      return { escalated: true };
    },
  };

  return [
    createOrGetSessionTool,
    getSessionHistoryTool,
    getOrderStatusTool,
    sendCustomerMessageTool,
    captureRescheduleTool,
    escalateToHumanTool,
  ];
}

export { closeSession };
