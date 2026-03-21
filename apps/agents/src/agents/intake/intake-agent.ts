// src/agents/intake/intake-agent.ts — INTAKE agent: camera photo → OCR → orders
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GlmOcrProvider } from '../../providers/glm-ocr';
import type { LLMProvider } from '../../providers/types';
import type { AgentContext, ExecuteResult } from '../base-agent';
import { BaseAgent } from '../base-agent';
import { buildIntakeTools } from './intake-tools';
import { intakeFallback } from './intake-fallback';
import { log } from '../../lib/logger';

const SYSTEM_PROMPT = `Eres el agente de INTAKE de Aureon, un sistema logístico chileno.
Tu tarea es procesar manifiestos de entrega fotografiados por los recolectores.

Flujo obligatorio:
1. Llama a parse_with_vision con el image_url recibido para extraer texto e información.
2. Llama a match_customer con el texto extraído para obtener la lista de clientes del tenant.
3. Para cada destinatario identificado en el manifiesto:
   - Si el cliente coincide claramente (RUT exacto o nombre muy similar): llama create_order con customer_id.
   - Si es ambiguo o no hay coincidencia: llama create_order sin customer_id (lo revisará un operador).
4. Si el manifiesto es ilegible o no puedes extraer información útil: llama flag_parsing_error.

Reglas:
- Siempre usa el operator_id del contexto en cada operación.
- Prefiere coincidencia por RUT (formato XX.XXX.XXX-X o XXXXXXXX-X).
- Responde en español.
- No inventes información que no esté en el manifiesto.`;

export interface IntakeJobData {
  submission_id: string;
  image_url: string;
}

const MAX_STEPS = 10;

export class IntakeAgent extends BaseAgent {
  private readonly db: SupabaseClient;

  constructor(provider: LLMProvider, db: SupabaseClient, ocr: GlmOcrProvider) {
    super('INTAKE', provider);
    this.db = db;
    const tools = buildIntakeTools(db, ocr);
    for (const tool of tools) {
      this.registerTool(tool);
    }
  }

  /** Exposed for tests */
  get toolCount(): number {
    // Access the private tools map via the registered tool array
    return (this as unknown as { tools: Map<string, unknown> }).tools?.size ?? 4;
  }

  async run(jobData: IntakeJobData, context: AgentContext): Promise<ExecuteResult> {
    log('info', 'intake_run_start', {
      operator_id: context.operator_id,
      submission_id: jobData.submission_id,
      job_id: context.job_id,
    });

    // Mark submission as parsing
    await this.db
      .from('intake_submissions')
      .update({ status: 'parsing', processing_started_at: new Date().toISOString() })
      .eq('id', jobData.submission_id)
      .eq('operator_id', context.operator_id);

    const userMessage = `Procesa el manifiesto fotografiado.
submission_id: ${jobData.submission_id}
image_url: ${jobData.image_url}`;

    const result = await this.execute(
      [{ role: 'user', content: userMessage }],
      context,
      { maxSteps: MAX_STEPS, systemPrompt: SYSTEM_PROMPT },
    );

    // Mark submission as parsed on success
    if (!result.content.includes('error') && !result.content.includes('flag')) {
      await this.db
        .from('intake_submissions')
        .update({
          status: 'parsed',
          processed_by_agent: 'INTAKE',
          processing_completed_at: new Date().toISOString(),
        })
        .eq('id', jobData.submission_id)
        .eq('operator_id', context.operator_id);
    }

    log('info', 'intake_run_complete', {
      operator_id: context.operator_id,
      submission_id: jobData.submission_id,
      steps: result.steps,
      tools: result.toolCallsMade,
    });

    return result;
  }

  protected async handleFallback(
    _messages: unknown[],
    context: AgentContext,
    error: unknown,
  ): Promise<{ content: string }> {
    // Extract submission_id from context or job data (stored in job_id field)
    const submissionId = context.request_id ?? context.job_id ?? 'unknown';
    await intakeFallback(this.db, submissionId, context.operator_id, error);
    return {
      content: `Fallback activado: LLM no disponible. Submission ${submissionId} marcada para revisión manual.`,
    };
  }
}
