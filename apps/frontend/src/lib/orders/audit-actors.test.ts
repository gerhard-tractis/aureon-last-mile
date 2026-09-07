import { describe, it, expect, vi } from 'vitest';
import {
  SYSTEM_ACTOR_ID,
  actorLabel,
  actorIdsToResolve,
  fetchActorDirectory,
  type ActorDirectory,
} from './audit-actors';

const DIR: ActorDirectory = {
  'user-1': { full_name: 'Ana Líder', email: 'lider@musan.com' },
  'user-2': { full_name: null, email: 'sin-nombre@musan.com' },
  'user-3': { full_name: null, email: null },
};

describe('actorLabel', () => {
  it('prefers the full name', () => {
    expect(actorLabel('user-1', DIR)).toBe('Ana Líder');
  });

  it('falls back to the email when the user has no name', () => {
    expect(actorLabel('user-2', DIR)).toBe('sin-nombre@musan.com');
  });

  // The trigger substitutes this sentinel whenever auth.uid() is null —
  // seeds, webhooks, service-role writes. Naming it "Sistema" is honest;
  // showing the zero UUID is not.
  it('names the trigger sentinel as the system', () => {
    expect(actorLabel(SYSTEM_ACTOR_ID, DIR)).toBe('Sistema');
  });

  it('names a null actor as the system', () => {
    expect(actorLabel(null, DIR)).toBe('Sistema');
  });

  // Omit, never fabricate: a deleted or other-operator user is invisible
  // under RLS, and inventing a name for them would be worse than silence.
  it('returns null for a user the directory does not contain', () => {
    expect(actorLabel('user-missing', DIR)).toBeNull();
  });

  it('returns null for a user with neither name nor email', () => {
    expect(actorLabel('user-3', DIR)).toBeNull();
  });
});

describe('actorIdsToResolve', () => {
  it('de-duplicates the ids it needs to look up', () => {
    expect(actorIdsToResolve([{ user_id: 'a' }, { user_id: 'a' }, { user_id: 'b' }])).toEqual(['a', 'b']);
  });

  it('never asks the database for the system sentinel', () => {
    expect(actorIdsToResolve([{ user_id: SYSTEM_ACTOR_ID }, { user_id: 'a' }])).toEqual(['a']);
  });

  it('skips null actors', () => {
    expect(actorIdsToResolve([{ user_id: null }, { user_id: 'a' }])).toEqual(['a']);
  });

  it('returns nothing when every row is the system', () => {
    expect(actorIdsToResolve([{ user_id: SYSTEM_ACTOR_ID }, { user_id: null }])).toEqual([]);
  });
});

describe('fetchActorDirectory', () => {
  function clientReturning(data: unknown, error: unknown = null) {
    const inFn = vi.fn().mockResolvedValue({ data, error });
    const eq = vi.fn().mockReturnValue({ in: inFn });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    return { client: { from }, from, select, eq, inFn };
  }

  it('builds a directory keyed by user id', async () => {
    const { client } = clientReturning([{ id: 'user-1', full_name: 'Ana', email: 'a@m.com' }]);
    const dir = await fetchActorDirectory(client as any, 'op-1', ['user-1']);
    expect(dir).toEqual({ 'user-1': { full_name: 'Ana', email: 'a@m.com' } });
  });

  it('scopes the lookup to the operator', async () => {
    const { client, eq } = clientReturning([]);
    await fetchActorDirectory(client as any, 'op-1', ['user-1']);
    expect(eq).toHaveBeenCalledWith('operator_id', 'op-1');
  });

  it('does not query at all when there is nothing to resolve', async () => {
    const { client, from } = clientReturning([]);
    const dir = await fetchActorDirectory(client as any, 'op-1', []);
    expect(from).not.toHaveBeenCalled();
    expect(dir).toEqual({});
  });

  // The bitácora must still render its events if the name lookup fails —
  // an unnamed event beats a blank panel.
  it('degrades to an empty directory instead of throwing when the lookup errors', async () => {
    const { client } = clientReturning(null, { message: 'nope' });
    const dir = await fetchActorDirectory(client as any, 'op-1', ['user-1']);
    expect(dir).toEqual({});
  });
});
