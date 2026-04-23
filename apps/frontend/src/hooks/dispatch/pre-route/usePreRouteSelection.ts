import { useState } from 'react';

export type PreRouteSelectionState = {
  selectedAndenIds: Set<string>;
  toggleSelect: (id: string) => void;
  clearSelection: () => void;
  expandedAndenIds: Set<string>;
  toggleAndenExpansion: (id: string) => void;
  expandedComunaIds: Set<string>;
  toggleComunaExpansion: (id: string) => void;
  allSelected: (ids: string[]) => boolean;
  toggleSelectAll: (ids: string[]) => void;
};

function toggle(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function usePreRouteSelection(): PreRouteSelectionState {
  const [selectedAndenIds, setSelected] = useState<Set<string>>(new Set());
  const [expandedAndenIds, setExpandedAnden] = useState<Set<string>>(new Set());
  const [expandedComunaIds, setExpandedComuna] = useState<Set<string>>(new Set());

  function allSelected(ids: string[]): boolean {
    if (ids.length === 0) return false;
    return ids.every((id) => selectedAndenIds.has(id));
  }

  function toggleSelectAll(ids: string[]) {
    if (allSelected(ids)) setSelected(new Set());
    else setSelected(new Set(ids));
  }

  return {
    selectedAndenIds,
    toggleSelect: (id) => setSelected((prev) => toggle(prev, id)),
    clearSelection: () => setSelected(new Set()),
    expandedAndenIds,
    toggleAndenExpansion: (id) => setExpandedAnden((prev) => toggle(prev, id)),
    expandedComunaIds,
    toggleComunaExpansion: (id) => setExpandedComuna((prev) => toggle(prev, id)),
    allSelected,
    toggleSelectAll,
  };
}
