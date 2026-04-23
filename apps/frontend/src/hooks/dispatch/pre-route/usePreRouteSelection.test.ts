import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePreRouteSelection } from './usePreRouteSelection';

describe('usePreRouteSelection', () => {
  it('starts with empty selection and no expanded items', () => {
    const { result } = renderHook(() => usePreRouteSelection());
    expect(result.current.selectedAndenIds.size).toBe(0);
    expect(result.current.expandedAndenIds.size).toBe(0);
    expect(result.current.expandedComunaIds.size).toBe(0);
  });

  it('toggleSelect adds id to selectedAndenIds', () => {
    const { result } = renderHook(() => usePreRouteSelection());
    act(() => result.current.toggleSelect('zone-1'));
    expect(result.current.selectedAndenIds.has('zone-1')).toBe(true);
  });

  it('toggleSelect removes already-selected id', () => {
    const { result } = renderHook(() => usePreRouteSelection());
    act(() => result.current.toggleSelect('zone-1'));
    act(() => result.current.toggleSelect('zone-1'));
    expect(result.current.selectedAndenIds.has('zone-1')).toBe(false);
  });

  it('clearSelection empties the selection set', () => {
    const { result } = renderHook(() => usePreRouteSelection());
    act(() => result.current.toggleSelect('zone-1'));
    act(() => result.current.toggleSelect('zone-2'));
    act(() => result.current.clearSelection());
    expect(result.current.selectedAndenIds.size).toBe(0);
  });

  it('toggleAndenExpansion adds id to expandedAndenIds', () => {
    const { result } = renderHook(() => usePreRouteSelection());
    act(() => result.current.toggleAndenExpansion('zone-1'));
    expect(result.current.expandedAndenIds.has('zone-1')).toBe(true);
  });

  it('toggleAndenExpansion collapses already-expanded andén', () => {
    const { result } = renderHook(() => usePreRouteSelection());
    act(() => result.current.toggleAndenExpansion('zone-1'));
    act(() => result.current.toggleAndenExpansion('zone-1'));
    expect(result.current.expandedAndenIds.has('zone-1')).toBe(false);
  });

  it('toggleComunaExpansion expands and collapses a commune', () => {
    const { result } = renderHook(() => usePreRouteSelection());
    act(() => result.current.toggleComunaExpansion('com-1'));
    expect(result.current.expandedComunaIds.has('com-1')).toBe(true);
    act(() => result.current.toggleComunaExpansion('com-1'));
    expect(result.current.expandedComunaIds.has('com-1')).toBe(false);
  });

  it('allSelected is false when no andenes provided or none selected', () => {
    const { result } = renderHook(() => usePreRouteSelection());
    expect(result.current.allSelected([])).toBe(false);
    expect(result.current.allSelected(['zone-1'])).toBe(false);
  });

  it('allSelected is true when all provided ids are selected', () => {
    const { result } = renderHook(() => usePreRouteSelection());
    act(() => result.current.toggleSelect('zone-1'));
    act(() => result.current.toggleSelect('zone-2'));
    expect(result.current.allSelected(['zone-1', 'zone-2'])).toBe(true);
  });

  it('toggleSelectAll selects all ids when not all selected', () => {
    const { result } = renderHook(() => usePreRouteSelection());
    act(() => result.current.toggleSelectAll(['zone-1', 'zone-2', 'zone-3']));
    expect(result.current.selectedAndenIds.size).toBe(3);
  });

  it('toggleSelectAll clears all when all already selected', () => {
    const { result } = renderHook(() => usePreRouteSelection());
    act(() => result.current.toggleSelectAll(['zone-1', 'zone-2']));
    act(() => result.current.toggleSelectAll(['zone-1', 'zone-2']));
    expect(result.current.selectedAndenIds.size).toBe(0);
  });
});
