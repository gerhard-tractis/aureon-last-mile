import { describe, it, expect, beforeEach } from 'vitest';
import { useConversationStore, INITIAL_CONVERSATION_STATE } from './conversationStore';

describe('conversationStore', () => {
  beforeEach(() => {
    // Reset to initial state between tests using Zustand's setState
    useConversationStore.setState(INITIAL_CONVERSATION_STATE);
  });

  it('starts with no selected session', () => {
    expect(useConversationStore.getState().selectedSessionId).toBeNull();
  });

  it('selects a session and clears its unread', () => {
    const store = useConversationStore.getState();
    store.markUnread('sess-1');
    store.selectSession('sess-1');
    const state = useConversationStore.getState();
    expect(state.selectedSessionId).toBe('sess-1');
    expect(state.unreadSessionIds.has('sess-1')).toBe(false);
  });

  it('tracks unread sessions', () => {
    useConversationStore.getState().markUnread('sess-2');
    expect(useConversationStore.getState().unreadSessionIds.has('sess-2')).toBe(true);
  });

  it('deselects session', () => {
    const store = useConversationStore.getState();
    store.selectSession('sess-1');
    store.selectSession(null);
    expect(useConversationStore.getState().selectedSessionId).toBeNull();
  });
});
