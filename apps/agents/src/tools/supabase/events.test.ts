// src/tools/supabase/events.test.ts
import { describe, it, expect, vi } from 'vitest';
import { logAgentEvent } from './events';

function makeDb(error: unknown = null) {
  const chain = {
    insert: vi.fn().mockResolvedValue({ error }),
  };
  return { from: vi.fn().mockReturnValue(chain) };
}

describe('logAgentEvent', () => {
  it('inserts into agent_events table', async () => {
    const db = makeDb();
    await logAgentEvent(db as never, {
      operator_id: 'op-1',
      agent: 'INTAKE',
      event_type: 'tool_call',
      meta: { tool: 'parse_with_vision' },
    });
    expect(db.from).toHaveBeenCalledWith('agent_events');
  });

  it('includes all required fields in the insert payload', async () => {
    const db = makeDb();
    await logAgentEvent(db as never, {
      operator_id: 'op-1',
      agent: 'INTAKE',
      event_type: 'decision',
      meta: { confidence: 0.9 },
    });
    const insertArgs = db.from('agent_events').insert.mock.calls[0][0];
    expect(insertArgs.operator_id).toBe('op-1');
    expect(insertArgs.agent).toBe('INTAKE');
    expect(insertArgs.event_type).toBe('decision');
    expect(insertArgs.meta).toEqual({ confidence: 0.9 });
  });

  it('does not throw on Supabase error (fire-and-forget audit trail)', async () => {
    const db = makeDb({ message: 'write failed' });
    // Must not throw — audit trail is best-effort
    await expect(
      logAgentEvent(db as never, {
        operator_id: 'op-1',
        agent: 'INTAKE',
        event_type: 'error',
        meta: {},
      }),
    ).resolves.not.toThrow();
  });
});
