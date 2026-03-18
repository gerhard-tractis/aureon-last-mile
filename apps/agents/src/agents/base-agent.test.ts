// src/agents/base-agent.test.ts — TDD tests for BaseAgent
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LLMProvider, LLMResponse, Message } from '../providers/types';

// Mock logger before importing base-agent
vi.mock('../lib/logger', () => ({
  log: vi.fn(),
}));

import { log } from '../lib/logger';
import { BaseAgent, AgentContext, AgentTool } from './base-agent';

// ── Concrete subclass for testing ────────────────────────────────────────────
class TestAgent extends BaseAgent {
  public fallbackCalled = false;
  public fallbackError: unknown = null;

  constructor(provider: LLMProvider) {
    super('test-agent', provider);
  }

  protected async handleFallback(
    _messages: Message[],
    _context: AgentContext,
    error: unknown,
  ): Promise<{ content: string }> {
    this.fallbackCalled = true;
    this.fallbackError = error;
    return { content: 'fallback response' };
  }
}

// ── Mock LLMProvider factory ──────────────────────────────────────────────────
function makeProvider(responses: Partial<LLMResponse>[]): LLMProvider {
  let callIndex = 0;
  return {
    model: 'mock-model',
    generate: vi.fn(async () => {
      const base: LLMResponse = {
        content: '',
        model: 'mock-model',
        finishReason: 'stop',
      };
      const response = { ...base, ...responses[callIndex] };
      callIndex = Math.min(callIndex + 1, responses.length - 1);
      return response;
    }),
  };
}

const baseContext: AgentContext = {
  operator_id: 'op-123',
  job_id: 'job-456',
  request_id: 'req-789',
};

// ── Tests ────────────────────────────────────────────────────────────────────
describe('BaseAgent.execute()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns content when LLM responds with stop', async () => {
    const provider = makeProvider([{ content: 'Hello world', finishReason: 'stop' }]);
    const agent = new TestAgent(provider);
    const messages: Message[] = [{ role: 'user', content: 'Hi' }];

    const result = await agent.execute(messages, baseContext);

    expect(result.content).toBe('Hello world');
    expect(result.steps).toBe(1);
    expect(result.toolCallsMade).toEqual([]);
  });

  it('calls tool and continues loop when LLM returns tool_calls', async () => {
    const provider = makeProvider([
      {
        content: '',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'tc-1', name: 'my_tool', arguments: { x: 1 } }],
      },
      { content: 'Done after tool', finishReason: 'stop' },
    ]);
    const agent = new TestAgent(provider);

    const toolExecute = vi.fn(async () => ({ result: 'tool output' }));
    const tool: AgentTool = {
      name: 'my_tool',
      description: 'A test tool',
      parameters: { type: 'object', properties: {} },
      execute: toolExecute,
    };
    agent.registerTool(tool);

    const messages: Message[] = [{ role: 'user', content: 'Use the tool' }];
    const result = await agent.execute(messages, baseContext);

    expect(toolExecute).toHaveBeenCalledWith({ x: 1 }, baseContext);
    expect(result.content).toBe('Done after tool');
    expect(result.steps).toBe(2);
    expect(result.toolCallsMade).toContain('my_tool');
  });

  it('stops after maxSteps even if LLM keeps returning tool_calls', async () => {
    // Every response is a tool_call — loop must terminate
    const provider = makeProvider([
      {
        content: 'step content',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'tc-1', name: 'loop_tool', arguments: {} }],
      },
    ]);
    const agent = new TestAgent(provider);

    const tool: AgentTool = {
      name: 'loop_tool',
      description: 'Loops forever',
      parameters: {},
      execute: vi.fn(async () => ({})),
    };
    agent.registerTool(tool);

    const messages: Message[] = [{ role: 'user', content: 'Loop' }];
    const result = await agent.execute(messages, baseContext, { maxSteps: 3 });

    expect(result.steps).toBe(3);
    // Should have called provider.generate exactly 3 times
    expect((provider.generate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
  });

  it('calls handleFallback() when LLM throws', async () => {
    const provider: LLMProvider = {
      model: 'mock-model',
      generate: vi.fn(async () => {
        throw new Error('LLM unavailable');
      }),
    };
    const agent = new TestAgent(provider);
    const messages: Message[] = [{ role: 'user', content: 'Hello' }];

    const result = await agent.execute(messages, baseContext);

    expect(agent.fallbackCalled).toBe(true);
    expect(result.content).toBe('fallback response');
  });

  it('includes registered tools in LLM request', async () => {
    const provider = makeProvider([{ content: 'ok', finishReason: 'stop' }]);
    const agent = new TestAgent(provider);

    const tool: AgentTool = {
      name: 'check_status',
      description: 'Checks delivery status',
      parameters: { type: 'object', properties: { id: { type: 'string' } } },
      execute: vi.fn(async () => ({})),
    };
    agent.registerTool(tool);

    const messages: Message[] = [{ role: 'user', content: 'Check it' }];
    await agent.execute(messages, baseContext);

    const generateCall = (provider.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(generateCall.tools).toBeDefined();
    expect(generateCall.tools).toHaveLength(1);
    expect(generateCall.tools[0].name).toBe('check_status');
    expect(generateCall.tools[0].description).toBe('Checks delivery status');
  });

  it('logEvent() calls log() with correct structure', () => {
    const provider = makeProvider([]);
    const agent = new TestAgent(provider);

    // Access protected logEvent via cast
    (agent as unknown as { logEvent: BaseAgent['logEvent'] }).logEvent(
      'decision',
      baseContext,
      { reason: 'test-reason' },
    );

    expect(log).toHaveBeenCalledWith(
      'info',
      'agent_event',
      expect.objectContaining({
        agent: 'test-agent',
        eventType: 'decision',
        operator_id: 'op-123',
        job_id: 'job-456',
        request_id: 'req-789',
        reason: 'test-reason',
      }),
    );
  });

  it('injects systemPrompt as first system message when provided', async () => {
    const provider = makeProvider([{ content: 'ack', finishReason: 'stop' }]);
    const agent = new TestAgent(provider);

    const messages: Message[] = [{ role: 'user', content: 'Hello' }];
    await agent.execute(messages, baseContext, { systemPrompt: 'You are a logistics expert.' });

    const generateCall = (provider.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(generateCall.messages[0]).toEqual({
      role: 'system',
      content: 'You are a logistics expert.',
    });
  });
});
