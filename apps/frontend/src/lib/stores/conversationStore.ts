import { create } from 'zustand';

interface ConversationStoreState {
  selectedSessionId: string | null;
  unreadSessionIds: Set<string>;
  selectSession: (id: string | null) => void;
  markUnread: (id: string) => void;
}

// Exported so tests can reset state with useConversationStore.setState(INITIAL_CONVERSATION_STATE)
export const INITIAL_CONVERSATION_STATE: Pick<ConversationStoreState, 'selectedSessionId' | 'unreadSessionIds'> = {
  selectedSessionId: null,
  unreadSessionIds: new Set(),
};

export const useConversationStore = create<ConversationStoreState>()((set, get) => ({
  ...INITIAL_CONVERSATION_STATE,

  selectSession: (id) =>
    set((state) => {
      const next = new Set(state.unreadSessionIds);
      if (id) next.delete(id);
      return { selectedSessionId: id, unreadSessionIds: next };
    }),

  markUnread: (id) =>
    set((state) => {
      if (state.selectedSessionId === id) return state;
      const next = new Set(state.unreadSessionIds);
      next.add(id);
      return { unreadSessionIds: next };
    }),
}));
