import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStageQuery } from './useStageQuery';

// Mock next/navigation
const mockReplace = vi.fn();
const mockGet = vi.fn();

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: mockGet }),
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/app/operations-control',
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockReturnValue(null);
});

describe('useStageQuery', () => {
  it('returns null activeStage when no ?stage= param', () => {
    mockGet.mockReturnValue(null);
    const { result } = renderHook(() => useStageQuery());
    expect(result.current.activeStage).toBeNull();
  });

  it('returns the stage key when ?stage=docks', () => {
    mockGet.mockReturnValue('docks');
    const { result } = renderHook(() => useStageQuery());
    expect(result.current.activeStage).toBe('docks');
  });

  it('returns null for an invalid stage key ?stage=bogus', () => {
    mockGet.mockReturnValue('bogus');
    const { result } = renderHook(() => useStageQuery());
    expect(result.current.activeStage).toBeNull();
  });

  it('calls router.replace with correct URL when setStage is called with a key', () => {
    mockGet.mockReturnValue(null);
    const { result } = renderHook(() => useStageQuery());
    act(() => {
      result.current.setStage('reception');
    });
    expect(mockReplace).toHaveBeenCalledWith(
      '/app/operations-control?stage=reception',
      { scroll: false }
    );
  });

  it('calls router.replace without ?stage= when setStage(null) is called', () => {
    mockGet.mockReturnValue('docks');
    const { result } = renderHook(() => useStageQuery());
    act(() => {
      result.current.setStage(null);
    });
    expect(mockReplace).toHaveBeenCalledWith(
      '/app/operations-control',
      { scroll: false }
    );
  });
});
