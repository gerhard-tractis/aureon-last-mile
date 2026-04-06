// Barrel re-export — all hooks moved to hooks/dashboard/ subdirectory (spec-28 H2).
export { useOperatorId } from './useOperatorId';
export * from './dashboard/useSlaMetrics';
export * from './dashboard/useFadrMetrics';
export * from './dashboard/useOrdersMetrics';
export * from './dashboard/useCustomerPerformance';
export * from './dashboard/useSecondaryMetrics';
export * from './dashboard/useFailureReasons';
export * from './dashboard/useExportData';
