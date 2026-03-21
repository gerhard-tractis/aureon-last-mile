// src/agents/intake/intake-tools.ts — Tool definitions for INTAKE agent
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GlmOcrProvider } from '../../providers/glm-ocr';
import type { AgentTool } from '../base-agent';
import { extractDocument } from '../../tools/ocr/extract-document';
import { getCustomersByOperator } from '../../tools/supabase/customers';
import { upsertOrder } from '../../tools/supabase/orders';
import { log } from '../../lib/logger';

export function buildIntakeTools(db: SupabaseClient, ocr: GlmOcrProvider): AgentTool[] {
  const parseWithVision: AgentTool = {
    name: 'parse_with_vision',
    description:
      'Extract structured data from a manifest photo using GLM-OCR. ' +
      'Returns raw text and extracted fields (company names, RUTs, addresses, line items).',
    parameters: {
      type: 'object',
      properties: {
        image_url: {
          type: 'string',
          description: 'Supabase Storage path of the manifest image (e.g. manifests/photo.jpg)',
        },
        submission_id: { type: 'string', description: 'intake_submissions.id for tracking' },
      },
      required: ['image_url', 'submission_id'],
    },
    async execute(args) {
      const { image_url } = args as { image_url: string; submission_id: string };
      return extractDocument(db, ocr, image_url);
    },
  };

  const matchCustomer: AgentTool = {
    name: 'match_customer',
    description:
      'Retrieve the tenant\'s customer list so the agent can fuzzy-match OCR text ' +
      'against known customers by RUT, name, address, or phone. Returns array of candidates.',
    parameters: {
      type: 'object',
      properties: {
        ocr_text: {
          type: 'string',
          description: 'Raw OCR text containing potential customer identifiers',
        },
      },
      required: ['ocr_text'],
    },
    async execute(_args, context) {
      return getCustomersByOperator(db, context.operator_id);
    },
  };

  const createOrder: AgentTool = {
    name: 'create_order',
    description:
      'Create a delivery order in the database from parsed manifest data. ' +
      'Call once per recipient row extracted from the manifest.',
    parameters: {
      type: 'object',
      properties: {
        submission_id: { type: 'string', description: 'intake_submissions.id to link' },
        customer_id: { type: 'string', description: 'Matched tenant_client id (if confident)' },
        customer_name: { type: 'string', description: 'Recipient name from manifest' },
        delivery_address: { type: 'string', description: 'Full delivery address from manifest' },
        phone: { type: 'string', description: 'Recipient phone number (optional)' },
        notes: { type: 'string', description: 'Additional delivery notes (optional)' },
        priority: { type: 'number', description: 'Priority 1–10 (default 5)' },
      },
      required: ['submission_id', 'customer_name', 'delivery_address'],
    },
    async execute(args, context) {
      const a = args as {
        submission_id: string;
        customer_id?: string;
        customer_name: string;
        delivery_address: string;
        phone?: string;
        notes?: string;
        priority?: number;
      };
      return upsertOrder(db, {
        operator_id: context.operator_id,
        intake_submission_id: a.submission_id,
        customer_id: a.customer_id,
        customer_name: a.customer_name,
        delivery_address: a.delivery_address,
        phone: a.phone ?? null,
        notes: a.notes ?? null,
        priority: a.priority ?? 5,
        agent_metadata: { last_agent: 'INTAKE' },
      });
    },
  };

  const flagParsingError: AgentTool = {
    name: 'flag_parsing_error',
    description:
      'Mark an intake submission as needs_review when parsing fails or customer matching ' +
      'is ambiguous. A human operator will review and correct the submission.',
    parameters: {
      type: 'object',
      properties: {
        submission_id: { type: 'string', description: 'intake_submissions.id to flag' },
        reason: { type: 'string', description: 'Human-readable reason for flagging' },
      },
      required: ['submission_id', 'reason'],
    },
    async execute(args, context) {
      const { submission_id, reason } = args as { submission_id: string; reason: string };
      const { error } = await db
        .from('intake_submissions')
        .update({ status: 'needs_review', validation_errors: [{ message: reason }] })
        .eq('id', submission_id)
        .eq('operator_id', context.operator_id);
      if (error) {
        log('warn', 'flag_parsing_error_failed', { submission_id, error: error.message });
      }
      return { flagged: true, submission_id, reason };
    },
  };

  return [parseWithVision, matchCustomer, createOrder, flagParsingError];
}
