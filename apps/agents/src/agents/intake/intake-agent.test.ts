// src/agents/intake/intake-agent.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntakeAgent } from './intake-agent';
import type { LLMProvider } from '../../providers/types';

function makeProvider(response: {
  content: string;
  finishReason: 'stop' | 'tool_calls' | 'max_tokens' | 'error';
  toolCalls?: { id: string; name: string; arguments: Record<string, unknown> }[];
}): LLMProvider {
  return {
    model: 'llama-3.3-70b-versatile',
    generate: vi.fn().mockResolvedValue(response),
  };
}

function makeDb() {
  const subChain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockResolvedValue({ error: null }),
  };
  const orderChain = {
    upsert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: 'ord-1' }, error: null }),
  };
  const customerChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue({ data: [], error: null }),
  };
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'intake_submissions') return subChain;
      if (table === 'orders') return orderChain;
      return customerChain;
    }),
    storage: {
      from: vi.fn().mockReturnValue({
        download: vi.fn().mockResolvedValue({
          data: { arrayBuffer: async () => Buffer.from('img') },
          error: null,
        }),
      }),
    },
  };
}

function makeOcr() {
  return {
    extractDocument: vi.fn().mockResolvedValue({
      text: 'Easy SpA\nRUT: 76543210-1\nAv. Las Condes 123',
      confidence: 0.9,
    }),
  };
}

describe('IntakeAgent', () => {
  let db: ReturnType<typeof makeDb>;
  let ocr: ReturnType<typeof makeOcr>;

  beforeEach(() => {
    db = makeDb();
    ocr = makeOcr();
  });

  it('is instantiated with provider, db, and ocr', () => {
    const provider = makeProvider({ content: '', finishReason: 'stop' });
    const agent = new IntakeAgent(provider, db as never, ocr as never);
    expect(agent).toBeDefined();
  });

  it('has 4 registered tools', () => {
    const provider = makeProvider({ content: '', finishReason: 'stop' });
    const agent = new IntakeAgent(provider, db as never, ocr as never);
    expect(agent.toolCount).toBe(4);
  });

  it('runs execute and returns a result when LLM says stop', async () => {
    const provider = makeProvider({ content: 'Done', finishReason: 'stop' });
    const agent = new IntakeAgent(provider, db as never, ocr as never);
    const result = await agent.run(
      { submission_id: 'sub-1', image_url: 'manifests/photo.jpg' },
      { operator_id: 'op-1', job_id: 'job-1' },
    );
    expect(result.content).toBe('Done');
  });

  it('marks submission as parsing when run starts', async () => {
    const provider = makeProvider({ content: 'OK', finishReason: 'stop' });
    const agent = new IntakeAgent(provider, db as never, ocr as never);
    await agent.run(
      { submission_id: 'sub-1', image_url: 'manifests/photo.jpg' },
      { operator_id: 'op-1', job_id: 'job-1' },
    );
    expect(db.from).toHaveBeenCalledWith('intake_submissions');
  });

  it('calls handleFallback when LLM throws', async () => {
    const provider: LLMProvider = {
      model: 'test',
      generate: vi.fn().mockRejectedValue(new Error('LLM down')),
    };
    const agent = new IntakeAgent(provider, db as never, ocr as never);
    const result = await agent.run(
      { submission_id: 'sub-1', image_url: 'manifests/photo.jpg' },
      { operator_id: 'op-1', job_id: 'job-1' },
    );
    // Fallback returns graceful message
    expect(result.content).toBeTruthy();
  });
});
