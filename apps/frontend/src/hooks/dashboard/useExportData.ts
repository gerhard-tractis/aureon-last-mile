import { useSlaMetric, useSlaPreviousPeriod } from './useSlaMetrics';
import { useFadrSummary, useFadrPreviousPeriod } from './useFadrMetrics';
import {
  usePerformanceMetricsSummary,
  useShortageClaimsMetric,
  useAvgDeliveryTimeMetric,
  useClaimsPreviousPeriod,
  useDeliveryTimePreviousPeriod,
} from './useOrdersMetrics';
import { useCustomerPerformance, type CustomerPerformanceRow } from './useCustomerPerformance';
import { useSecondaryMetrics, useSecondaryMetricsPreviousPeriod, type SecondaryMetrics } from './useSecondaryMetrics';
import { useFailureReasons, type FailureReasonRow } from './useFailureReasons';

export type DashboardExportData = {
  sla: { value: number | null; prevValue: number | null; totalOrders: number; deliveredOrders: number };
  primary: {
    fadrValue: number | null;
    fadrPrev: number | null;
    fadrFirstAttempt: number;
    fadrTotal: number;
    claimsCount: number;
    claimsAmount: number;
    claimsPrevCount: number;
    claimsPrevAmount: number;
    avgDeliveryTime: number | null;
    prevAvgDeliveryTime: number | null;
  };
  customers: CustomerPerformanceRow[];
  failures: FailureReasonRow[];
  secondary: SecondaryMetrics | null;
  prevSecondary: SecondaryMetrics | null;
};

export function useExportData(
  operatorId: string | null,
  startDate: string,
  endDate: string,
  prevStartDate: string,
  prevEndDate: string,
  enabled: boolean
) {
  const gatedOperatorId = enabled ? operatorId : null;

  const sla = useSlaMetric(gatedOperatorId, startDate, endDate);
  const slaPrev = useSlaPreviousPeriod(gatedOperatorId, prevStartDate, prevEndDate);
  const perf = usePerformanceMetricsSummary(gatedOperatorId, startDate, endDate);
  const fadrSummary = useFadrSummary(gatedOperatorId, startDate, endDate);
  const fadrPrev = useFadrPreviousPeriod(gatedOperatorId, prevStartDate, prevEndDate);
  const claims = useShortageClaimsMetric(gatedOperatorId, startDate, endDate);
  const claimsPrev = useClaimsPreviousPeriod(gatedOperatorId, prevStartDate, prevEndDate);
  const avgTime = useAvgDeliveryTimeMetric(gatedOperatorId, startDate, endDate);
  const avgTimePrev = useDeliveryTimePreviousPeriod(gatedOperatorId, prevStartDate, prevEndDate);
  const customers = useCustomerPerformance(gatedOperatorId, startDate, endDate);
  const failures = useFailureReasons(gatedOperatorId, startDate, endDate);
  const secondary = useSecondaryMetrics(gatedOperatorId, startDate, endDate);
  const secondaryPrev = useSecondaryMetricsPreviousPeriod(gatedOperatorId, prevStartDate, prevEndDate);

  const isLoading =
    sla.isLoading || slaPrev.isLoading || perf.isLoading || fadrSummary.isLoading ||
    fadrPrev.isLoading || claims.isLoading || claimsPrev.isLoading || avgTime.isLoading ||
    avgTimePrev.isLoading || customers.isLoading || failures.isLoading ||
    secondary.isLoading || secondaryPrev.isLoading;

  const isError =
    sla.isError || perf.isError || fadrSummary.isError || claims.isError ||
    avgTime.isError || customers.isError || failures.isError || secondary.isError;

  const data: DashboardExportData | null =
    !enabled || isLoading
      ? null
      : {
          sla: {
            value: sla.data ?? null,
            prevValue: slaPrev.data ?? null,
            totalOrders: perf.data?.totalOrders ?? 0,
            deliveredOrders: perf.data?.deliveredOrders ?? 0,
          },
          primary: {
            fadrValue: fadrSummary.data && fadrSummary.data.total > 0
              ? Math.round((fadrSummary.data.firstAttempt / fadrSummary.data.total) * 1000) / 10
              : null,
            fadrPrev: fadrPrev.data ?? null,
            fadrFirstAttempt: fadrSummary.data?.firstAttempt ?? 0,
            fadrTotal: fadrSummary.data?.total ?? 0,
            claimsCount: claims.data?.count ?? 0,
            claimsAmount: claims.data?.amount ?? 0,
            claimsPrevCount: claimsPrev.data?.count ?? 0,
            claimsPrevAmount: claimsPrev.data?.amount ?? 0,
            avgDeliveryTime: avgTime.data ?? null,
            prevAvgDeliveryTime: avgTimePrev.data ?? null,
          },
          customers: customers.data ?? [],
          failures: failures.data ?? [],
          secondary: secondary.data ?? null,
          prevSecondary: secondaryPrev.data ?? null,
        };

  return { data, isLoading, isError };
}
