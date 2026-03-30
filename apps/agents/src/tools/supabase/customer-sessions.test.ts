import { describe, it, expect, vi } from 'vitest';
import {
  createOrGetSession,
  getSessionHistory,
  logSessionMessage,
  closeSession,
  escalateSession,
} from './customer-sessions';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSession(overrides = {}) {
  return {
    id: 'sess-1', operator_id: 'op-1', order_id: 'ord-1',
    customer_phone: '+56912345678', customer_name: 'Juan',
    status: 'active', escalated_at: null, closed_at: null,
    created_at: '2026-03-30T00:00:00Z', updated_at: '2026-03-30T00:00:00Z',
    ...overrides,
  };
}

function makeMessage(overrides = {}) {
  return {
    id: 'msg-1', operator_id: 'op-1', session_id: 'sess-1',
    role: 'system', body: 'Tu pedido fue recogido.',
    external_message_id: 'wamid.abc', wa_status: 'sent',
    template_name: null, action_taken: 'pickup_notified',
    created_at: '2026-03-30T00:00:00Z',
    ...overrides,
  };
}

// Generic chainable mock builder
function makeDb(options: {
  maybeSingleResult?: unknown;
  maybeSingleError?: { message: string } | null;
  insertResult?: unknown;
  insertError?: { message: string } | null;
  selectListResult?: unknown[];
  selectListError?: { message: string } | null;
  updateError?: { message: string } | null;
} = {}) {
  const {
    maybeSingleResult = null,
    maybeSingleError = null,
    insertResult = makeSession(),
    insertError = null,
    selectListResult = [],
    selectListError = null,
    updateError = null,
  } = options;

  const chain: Record<string, unknown> = {};
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.select = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: maybeSingleResult, error: maybeSingleError });
  chain.single = vi.fn().mockResolvedValue({ data: insertResult, error: insertError });
  // For order() + no terminator — used in getSessionHistory
  chain.order.mockImplementation(() => ({
    ...chain,
    then: undefined, // ensure it's treated as a chainable not a promise
  }));
  // selectListResult resolves when eq chain ends with no .single()/.maybeSingle()
  // For the list query, replace the eq chain final with a direct mock:
  const listChain: Record<string, unknown> = {};
  listChain.eq = vi.fn().mockReturnValue(listChain);
  listChain.is = vi.fn().mockReturnValue(listChain);
  listChain.order = vi.fn().mockResolvedValue({ data: selectListResult, error: selectListError });

  const fromMap: Record<string, unknown> = {
    customer_sessions: chain,
    customer_session_messages: listChain,
  };

  return {
    from: vi.fn((table: string) => {
      if (table === 'customer_session_messages') {
        // For logSessionMessage (insert) we need insert chain; for getSessionHistory (select) we need list chain
        const msgChain: Record<string, unknown> = {};
        msgChain.select = vi.fn().mockReturnValue(msgChain);
        msgChain.eq = vi.fn().mockReturnValue(msgChain);
        msgChain.is = vi.fn().mockReturnValue(msgChain);
        msgChain.order = vi.fn().mockResolvedValue({ data: selectListResult, error: selectListError });
        msgChain.insert = vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: insertResult, error: insertError }),
          }),
        });
        return msgChain;
      }
      // customer_sessions
      const sessChain: Record<string, unknown> = {};
      sessChain.eq = vi.fn().mockReturnValue(sessChain);
      sessChain.is = vi.fn().mockReturnValue(sessChain);
      sessChain.maybeSingle = vi.fn().mockResolvedValue({ data: maybeSingleResult, error: maybeSingleError });
      sessChain.insert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: insertResult, error: insertError }),
        }),
      });
      sessChain.update = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: updateError }),
        }),
      });
      sessChain.select = vi.fn().mockReturnValue(sessChain);
      return sessChain;
    }),
    fromMap,
  };
}

// ── createOrGetSession ────────────────────────────────────────────────────────

describe('createOrGetSession', () => {
  it('returns existing session when one exists', async () => {
    const existing = makeSession();
    const db = makeDb({ maybeSingleResult: existing });
    const result = await createOrGetSession(db as never, {
      operator_id: 'op-1', order_id: 'ord-1', customer_phone: '+56912345678',
    });
    expect(result.id).toBe('sess-1');
  });

  it('creates new session when none exists', async () => {
    const newSession = makeSession({ id: 'sess-new' });
    const db = makeDb({ maybeSingleResult: null, insertResult: newSession });
    const result = await createOrGetSession(db as never, {
      operator_id: 'op-1', order_id: 'ord-1', customer_phone: '+56912345678', customer_name: 'Juan',
    });
    expect(result.id).toBe('sess-new');
  });

  it('throws on Supabase fetch error', async () => {
    const db = makeDb({ maybeSingleError: { message: 'DB error' } });
    await expect(createOrGetSession(db as never, {
      operator_id: 'op-1', order_id: 'ord-1', customer_phone: '+56912345678',
    })).rejects.toMatchObject({ message: expect.stringContaining('DB error') });
  });
});

// ── getSessionHistory ─────────────────────────────────────────────────────────

describe('getSessionHistory', () => {
  it('returns ordered messages for session', async () => {
    const msgs = [makeMessage(), makeMessage({ id: 'msg-2', role: 'user', body: '¿Dónde está mi pedido?' })];
    const db = makeDb({ selectListResult: msgs });
    const result = await getSessionHistory(db as never, 'sess-1', 'op-1');
    expect(result).toHaveLength(2);
  });

  it('returns empty array when no messages', async () => {
    const db = makeDb({ selectListResult: [] });
    const result = await getSessionHistory(db as never, 'sess-1', 'op-1');
    expect(result).toEqual([]);
  });

  it('throws on Supabase error', async () => {
    const db = makeDb({ selectListError: { message: 'list error' } });
    await expect(getSessionHistory(db as never, 'sess-1', 'op-1'))
      .rejects.toMatchObject({ message: expect.stringContaining('list error') });
  });
});

// ── logSessionMessage ─────────────────────────────────────────────────────────

describe('logSessionMessage', () => {
  it('inserts system message and returns it', async () => {
    const msg = makeMessage();
    const db = makeDb({ insertResult: msg });
    const result = await logSessionMessage(db as never, {
      operator_id: 'op-1', session_id: 'sess-1', role: 'system',
      body: 'Tu pedido fue recogido.', action_taken: 'pickup_notified',
    });
    expect(result.id).toBe('msg-1');
  });

  it('throws on insert error', async () => {
    const db = makeDb({ insertError: { message: 'insert fail' } });
    await expect(logSessionMessage(db as never, {
      operator_id: 'op-1', session_id: 'sess-1', role: 'user', body: 'hola',
    })).rejects.toMatchObject({ message: expect.stringContaining('insert fail') });
  });
});

// ── closeSession / escalateSession ────────────────────────────────────────────

describe('closeSession', () => {
  it('updates session to closed', async () => {
    const db = makeDb();
    await expect(closeSession(db as never, 'sess-1', 'op-1')).resolves.not.toThrow();
  });

  it('throws on DB error', async () => {
    const db = makeDb({ updateError: { message: 'update fail' } });
    await expect(closeSession(db as never, 'sess-1', 'op-1'))
      .rejects.toMatchObject({ message: expect.stringContaining('update fail') });
  });
});

describe('escalateSession', () => {
  it('updates session to escalated', async () => {
    const db = makeDb();
    await expect(escalateSession(db as never, 'sess-1', 'op-1')).resolves.not.toThrow();
  });
});
