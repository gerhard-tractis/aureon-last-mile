// src/agents/base-agent.ts — Abstract base class for all domain agents
import { log } from '../lib/logger';
import type { LLMProvider, Message, ToolDefinition } from '../providers/types';

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  execute(args: Record<string, unknown>, context: AgentContext): Promise<unknown>;
}

export interface AgentContext {
  operator_id: string;
  job_id?: string;
  request_id?: string;
}

export interface ExecuteResult {
  content: string;
  steps: number;
  toolCallsMade: string[];
}

export interface ExecuteOptions {
  maxSteps?: number;
  systemPrompt?: string;
}

const DEFAULT_MAX_STEPS = 10;

export abstract class BaseAgent {
  protected readonly agentName: string;
  private tools: Map<string, AgentTool> = new Map();

  constructor(
    agentName: string,
    protected readonly provider: LLMProvider,
  ) {
    this.agentName = agentName;
  }

  registerTool(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  async execute(
    messages: Message[],
    context: AgentContext,
    options?: ExecuteOptions,
  ): Promise<ExecuteResult> {
    const maxSteps = options?.maxSteps ?? DEFAULT_MAX_STEPS;
    const toolCallsMade: string[] = [];

    // Build working message list — prepend system prompt if provided
    const workingMessages: Message[] = options?.systemPrompt
      ? [{ role: 'system', content: options.systemPrompt }, ...messages]
      : [...messages];

    // Build tool definitions for LLM
    const toolDefs: ToolDefinition[] = Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    let lastContent = '';
    let steps = 0;

    while (steps < maxSteps) {
      steps++;

      let response;
      try {
        response = await this.provider.generate({
          messages: workingMessages,
          tools: toolDefs.length > 0 ? toolDefs : undefined,
        });
      } catch (err) {
        this.logEvent('llm_fallback', context, { error: String(err), step: steps });
        const fallback = await this.handleFallback(messages, context, err);
        return { content: fallback.content, steps, toolCallsMade };
      }

      lastContent = response.content;

      if (response.finishReason === 'stop' || response.finishReason === 'max_tokens') {
        return { content: lastContent, steps, toolCallsMade };
      }

      if (response.finishReason === 'tool_calls' && response.toolCalls?.length) {
        // Execute each tool call and append results to messages
        const assistantMsg: Message = {
          role: 'assistant',
          content: response.content,
        };
        workingMessages.push(assistantMsg);

        for (const tc of response.toolCalls) {
          toolCallsMade.push(tc.name);
          this.logEvent('tool_call', context, { tool: tc.name, callId: tc.id });

          const tool = this.tools.get(tc.name);
          let toolResult: unknown;
          if (tool) {
            try {
              toolResult = await tool.execute(tc.arguments, context);
            } catch (err) {
              toolResult = { error: String(err) };
              this.logEvent('error', context, { tool: tc.name, error: String(err) });
            }
          } else {
            toolResult = { error: `Unknown tool: ${tc.name}` };
          }

          // Append tool result as a user message (tool result role)
          workingMessages.push({
            role: 'user',
            content: JSON.stringify({ tool_call_id: tc.id, result: toolResult }),
          });
        }
        // Continue loop
        continue;
      }

      // Any other finishReason (error, unknown) — stop
      return { content: lastContent, steps, toolCallsMade };
    }

    // maxSteps reached
    return { content: lastContent, steps, toolCallsMade };
  }

  protected abstract handleFallback(
    messages: Message[],
    context: AgentContext,
    error: unknown,
  ): Promise<{ content: string }>;

  protected logEvent(
    eventType: 'tool_call' | 'llm_fallback' | 'error' | 'decision',
    context: AgentContext,
    meta: Record<string, unknown>,
  ): void {
    log('info', 'agent_event', {
      agent: this.agentName,
      eventType,
      operator_id: context.operator_id,
      job_id: context.job_id,
      request_id: context.request_id,
      ...meta,
    });
  }
}
