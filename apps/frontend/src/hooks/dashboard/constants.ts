import { keepPreviousData } from '@tanstack/react-query';

export const DASHBOARD_QUERY_OPTIONS = {
  staleTime: 30000,
  refetchInterval: 60000,
  placeholderData: keepPreviousData,
} as const;

export const DAILY_CAPACITY = 1000; // TODO: make configurable via settings (spec-28 L5)
export const OPERATIONAL_HOURS = 10; // TODO: make configurable via settings (spec-28 L5)
