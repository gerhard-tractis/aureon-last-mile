// src/agents/intake/intake-tools.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildIntakeTools } from './intake-tools';
import type { AgentContext } from '../base-agent';

function makeContext(operatorId = 'op-1'): AgentContext {
  return { operator_id: operatorId, job_id: 'job-1' };
}

// ── parse_with_vision ────────────────────────────────────────────────────────

describe('parse_with_vision tool', () => {
  it('returns extracted text and confidence from OCR', async () => {
    const ocr = {
      extractDocument: vi.fn().mockResolvedValue({
        text: 'Easy SpA\nRUT: 76543210-1',
        confidence: 0.9,
        fields: { company: 'Easy SpA' },
      }),
    };
    const db = {
      storage: {
        from: vi.fn().mockReturnValue({
          download: vi.fn().mockResolvedValue({
            data: { arrayBuffer: async () => Buffer.from('img') },
            error: null,
          }),
        }),
      },
    };
    const tools = buildIntakeTools(db as never, ocr as never);
    const pvTool = tools.find((t) => t.name === 'parse_with_vision')!;
    const result = await pvTool.execute(
      { image_url: 'manifests/photo.jpg', submission_id: 'sub-1' },
      makeContext(),
    ) as { text: string; confidence: number };
    expect(result.text).toBe('Easy SpA\nRUT: 76543210-1');
    expect(result.confidence).toBe(0.9);
  });
});

// ── match_customer ────────────────────────────────────────────────────────────

describe('match_customer tool', () => {
  it('returns list of customers for the operator', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({
        data: [{ id: 'c-1', name: 'Easy SpA', rut: '76543210-1', phone: null }],
        error: null,
      }),
    };
    const db = { from: vi.fn().mockReturnValue(chain), storage: { from: vi.fn() } };
    const tools = buildIntakeTools(db as never, {} as never);
    const mcTool = tools.find((t) => t.name === 'match_customer')!;
    const result = await mcTool.execute({ ocr_text: 'Easy SpA' }, makeContext()) as unknown[];
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'c-1', name: 'Easy SpA' });
  });
});

// ── create_order ─────────────────────────────────────────────────────────────

describe('create_order tool', () => {
  it('inserts order and returns id', async () => {
    const chain = {
      upsert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'ord-new' }, error: null }),
    };
    const db = { from: vi.fn().mockReturnValue(chain), storage: { from: vi.fn() } };
    const tools = buildIntakeTools(db as never, {} as never);
    const coTool = tools.find((t) => t.name === 'create_order')!;
    const result = await coTool.execute(
      {
        submission_id: 'sub-1',
        customer_id: 'c-1',
        customer_name: 'Easy SpA',
        delivery_address: 'Av. Las Condes 123',
      },
      makeContext(),
    ) as { id: string };
    expect(result.id).toBe('ord-new');
  });
});

// ── flag_parsing_error ────────────────────────────────────────────────────────

describe('flag_parsing_error tool', () => {
  it('updates submission status to needs_review', async () => {
    const inner = { eq: vi.fn().mockResolvedValue({ error: null }) };
    const chain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnValue(inner),
    };
    const db = { from: vi.fn().mockReturnValue(chain), storage: { from: vi.fn() } };
    const tools = buildIntakeTools(db as never, {} as never);
    const fpTool = tools.find((t) => t.name === 'flag_parsing_error')!;
    await fpTool.execute({ submission_id: 'sub-1', reason: 'ambiguous customer' }, makeContext());
    expect(db.from).toHaveBeenCalledWith('intake_submissions');
  });
});

// ── tool schema coverage ──────────────────────────────────────────────────────

describe('buildIntakeTools', () => {
  it('returns exactly 4 tools', () => {
    const db = { from: vi.fn(), storage: { from: vi.fn() } };
    const tools = buildIntakeTools(db as never, {} as never);
    expect(tools).toHaveLength(4);
  });

  it('all tools have name, description, parameters, execute', () => {
    const db = { from: vi.fn(), storage: { from: vi.fn() } };
    const tools = buildIntakeTools(db as never, {} as never);
    for (const t of tools) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.parameters).toMatchObject({ type: 'object' });
      expect(typeof t.execute).toBe('function');
    }
  });
});
