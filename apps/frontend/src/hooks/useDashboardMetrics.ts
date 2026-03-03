import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { createSPAClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/types';

type RpcFunctions = Database['public']['Functions'];
type SlaArgs = RpcFunctions['calculate_sla']['Args'];
type FadrArgs = RpcFunctions['calculate_fadr']['Args'];
type FailureReasonsArgs = RpcFunctions['get_failure_reasons']['Args'];

const DASHBOARD_QUERY_OPTIONS = {
  staleTime: 30000,
  refetchInterval: 30000,
} as const;

export function useOperatorId() {
  const [operatorId, setOperatorId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createSPAClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      const claims = session?.user?.app_metadata?.claims;
      setOperatorId(claims?.operator_id ?? null);
      setRole(claims?.role ?? null);
    });
  }, []);

  return { operatorId, role };
}

export function useSlaMetric(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'sla', startDate, endDate],
    queryFn: async () => {
      const args: SlaArgs = {
        p_operator_id: operatorId!,
        p_start_date: startDate,
        p_end_date: endDate,
      };
      const { data, error } = await (createSPAClient().rpc as CallableFunction)('calculate_sla', args);
      if (error) throw error;
      return data as number | null;
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

export function useFadrMetric(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'fadr', startDate, endDate],
    queryFn: async () => {
      const args: FadrArgs = {
        p_operator_id: operatorId!,
        p_start_date: startDate,
        p_end_date: endDate,
      };
      const { data, error } = await (createSPAClient().rpc as CallableFunction)('calculate_fadr', args);
      if (error) throw error;
      return data as number | null;
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

export type MetricsSummary = {
  totalOrders: number;
  deliveredOrders: number;
  failedDeliveries: number;
} | null;

export function usePerformanceMetricsSummary(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'performance', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('performance_metrics')
        .select('total_orders, delivered_orders, failed_deliveries')
        .eq('operator_id', operatorId!)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .is('retailer_name', null);
      if (error) throw error;
      if (!data || data.length === 0) return null;

      return (data as { total_orders: number; delivered_orders: number; failed_deliveries: number }[]).reduce<NonNullable<MetricsSummary>>(
        (acc, row) => ({
          totalOrders: acc.totalOrders + (row.total_orders ?? 0),
          deliveredOrders: acc.deliveredOrders + (row.delivered_orders ?? 0),
          failedDeliveries: acc.failedDeliveries + (row.failed_deliveries ?? 0),
        }),
        { totalOrders: 0, deliveredOrders: 0, failedDeliveries: 0 }
      );
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

// === Story 3.3 hooks ===

export type ShortageClaimsMetric = {
  count: number;
  amount: number;
} | null;

export type DailyMetricPoint = {
  date: string;
  value: number;
};

export function useShortageClaimsMetric(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'claims', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('performance_metrics')
        .select('shortage_claims_count, shortage_claims_amount_clp')
        .eq('operator_id', operatorId!)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .is('retailer_name', null);
      if (error) throw error;
      if (!data || data.length === 0) return null;
      return (data as { shortage_claims_count: number; shortage_claims_amount_clp: number }[]).reduce(
        (acc, row) => ({
          count: acc.count + (row.shortage_claims_count ?? 0),
          amount: acc.amount + (row.shortage_claims_amount_clp ?? 0),
        }),
        { count: 0, amount: 0 }
      ) as ShortageClaimsMetric;
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

export function useAvgDeliveryTimeMetric(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'avg-delivery-time', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('performance_metrics')
        .select('avg_delivery_time_minutes, total_orders')
        .eq('operator_id', operatorId!)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .is('retailer_name', null);
      if (error) throw error;
      if (!data || data.length === 0) return null;
      const rows = data as { avg_delivery_time_minutes: number | null; total_orders: number }[];
      let totalTime = 0;
      let totalOrders = 0;
      for (const row of rows) {
        if (row.avg_delivery_time_minutes != null && row.total_orders > 0) {
          totalTime += row.avg_delivery_time_minutes * row.total_orders;
          totalOrders += row.total_orders;
        }
      }
      return totalOrders > 0 ? totalTime / totalOrders : null;
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

const ALLOWED_METRIC_COLUMNS = [
  'first_attempt_deliveries',
  'shortage_claims_count',
  'shortage_claims_amount_clp',
  'avg_delivery_time_minutes',
  'total_orders',
  'delivered_orders',
  'failed_deliveries',
] as const;

type MetricColumn = (typeof ALLOWED_METRIC_COLUMNS)[number];

export function useDailyMetricsSeries(
  operatorId: string | null,
  startDate: string,
  endDate: string,
  metricColumn: MetricColumn
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'daily-series', metricColumn, startDate, endDate],
    queryFn: async () => {
      if (!ALLOWED_METRIC_COLUMNS.includes(metricColumn)) {
        throw new Error(`Invalid metric column: ${metricColumn}`);
      }
      const { data, error } = await createSPAClient()
        .from('performance_metrics')
        .select(`metric_date, ${metricColumn}`)
        .eq('operator_id', operatorId!)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .is('retailer_name', null)
        .order('metric_date', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row: Record<string, unknown>) => ({
        date: row.metric_date as string,
        value: (row[metricColumn] as number) ?? 0,
      })) as DailyMetricPoint[];
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

export function useFadrDailySeries(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'daily-series', 'fadr-pct', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('performance_metrics')
        .select('metric_date, first_attempt_deliveries, total_orders')
        .eq('operator_id', operatorId!)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .is('retailer_name', null)
        .order('metric_date', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row: Record<string, unknown>) => {
        const fa = (row.first_attempt_deliveries as number) ?? 0;
        const total = (row.total_orders as number) ?? 0;
        return {
          date: row.metric_date as string,
          value: total > 0 ? (fa / total) * 100 : 0,
        };
      }) as DailyMetricPoint[];
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

export function useFadrSummary(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'fadr-summary', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('performance_metrics')
        .select('first_attempt_deliveries, total_orders')
        .eq('operator_id', operatorId!)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .is('retailer_name', null);
      if (error) throw error;
      if (!data || data.length === 0) return null;
      const rows = data as { first_attempt_deliveries: number; total_orders: number }[];
      const totalFa = rows.reduce((sum, r) => sum + (r.first_attempt_deliveries ?? 0), 0);
      const totalOrders = rows.reduce((sum, r) => sum + (r.total_orders ?? 0), 0);
      return { firstAttempt: totalFa, total: totalOrders };
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

export function useFadrPreviousPeriod(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'fadr-prev', startDate, endDate],
    queryFn: async () => {
      const args: FadrArgs = {
        p_operator_id: operatorId!,
        p_start_date: startDate,
        p_end_date: endDate,
      };
      const { data, error } = await (createSPAClient().rpc as CallableFunction)('calculate_fadr', args);
      if (error) throw error;
      return data as number | null;
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

export function useClaimsPreviousPeriod(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'claims-prev', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('performance_metrics')
        .select('shortage_claims_count, shortage_claims_amount_clp')
        .eq('operator_id', operatorId!)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .is('retailer_name', null);
      if (error) throw error;
      if (!data || data.length === 0) return null;
      return (data as { shortage_claims_count: number; shortage_claims_amount_clp: number }[]).reduce(
        (acc, row) => ({
          count: acc.count + (row.shortage_claims_count ?? 0),
          amount: acc.amount + (row.shortage_claims_amount_clp ?? 0),
        }),
        { count: 0, amount: 0 }
      ) as ShortageClaimsMetric;
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

export function useDeliveryTimePreviousPeriod(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'avg-delivery-time-prev', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('performance_metrics')
        .select('avg_delivery_time_minutes, total_orders')
        .eq('operator_id', operatorId!)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .is('retailer_name', null);
      if (error) throw error;
      if (!data || data.length === 0) return null;
      const rows = data as { avg_delivery_time_minutes: number | null; total_orders: number }[];
      let totalTime = 0;
      let totalOrders = 0;
      for (const row of rows) {
        if (row.avg_delivery_time_minutes != null && row.total_orders > 0) {
          totalTime += row.avg_delivery_time_minutes * row.total_orders;
          totalOrders += row.total_orders;
        }
      }
      return totalOrders > 0 ? totalTime / totalOrders : null;
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

// === Story 3.4 hooks ===

export type CustomerPerformanceRow = {
  retailer_name: string;
  total_orders: number;
  delivered_orders: number;
  first_attempt_deliveries: number;
  failed_deliveries: number;
  sla_pct: number | null;
  fadr_pct: number | null;
};

export function useCustomerPerformance(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'customer-performance', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('performance_metrics')
        .select('retailer_name, total_orders, delivered_orders, first_attempt_deliveries, failed_deliveries')
        .eq('operator_id', operatorId!)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .not('retailer_name', 'is', null);
      if (error) throw error;

      type RawRow = { retailer_name: string | null; total_orders: number; delivered_orders: number; first_attempt_deliveries: number; failed_deliveries: number };
      // Aggregate by retailer_name in JS
      const byRetailer = new Map<string, CustomerPerformanceRow>();
      for (const row of (data ?? []) as RawRow[]) {
        const key = row.retailer_name!;
        const existing = byRetailer.get(key) ?? {
          retailer_name: key,
          total_orders: 0,
          delivered_orders: 0,
          first_attempt_deliveries: 0,
          failed_deliveries: 0,
          sla_pct: null,
          fadr_pct: null,
        };
        existing.total_orders += row.total_orders ?? 0;
        existing.delivered_orders += row.delivered_orders ?? 0;
        existing.first_attempt_deliveries += row.first_attempt_deliveries ?? 0;
        existing.failed_deliveries += row.failed_deliveries ?? 0;
        byRetailer.set(key, existing);
      }

      // Calculate percentages
      return Array.from(byRetailer.values()).map(r => ({
        ...r,
        sla_pct: r.total_orders > 0
          ? Math.round((r.delivered_orders / r.total_orders) * 1000) / 10
          : null,
        fadr_pct: r.total_orders > 0
          ? Math.round((r.first_attempt_deliveries / r.total_orders) * 1000) / 10
          : null,
      }));
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

export function useSlaPreviousPeriod(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'sla-prev', startDate, endDate],
    queryFn: async () => {
      const args: SlaArgs = {
        p_operator_id: operatorId!,
        p_start_date: startDate,
        p_end_date: endDate,
      };
      const { data, error } = await (createSPAClient().rpc as CallableFunction)('calculate_sla', args);
      if (error) throw error;
      return data as number | null;
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

// === Story 3.5 hooks ===

export type FailureReasonRow = {
  reason: string;
  count: number;
  percentage: number;
};

// === Story 3.6 hooks ===

export type SecondaryMetrics = {
  capacityPct: number | null;
  capacityTarget: number;
  ordersPerHour: number | null;
  totalOrders: number;
  totalDelivered: number;
  daysInPeriod: number;
  operationalHours: number;
};

const DAILY_CAPACITY = 1000; // TODO: make configurable via settings
const OPERATIONAL_HOURS = 10; // TODO: make configurable via settings

async function fetchSecondaryMetrics(
  operatorId: string,
  startDate: string,
  endDate: string
): Promise<SecondaryMetrics> {
  const { data, error } = await createSPAClient()
    .from('performance_metrics')
    .select('total_orders, delivered_orders')
    .eq('operator_id', operatorId)
    .gte('metric_date', startDate)
    .lte('metric_date', endDate)
    .is('retailer_name', null);
  if (error) throw error;

  const totals = (data ?? []).reduce(
    (acc, row) => ({
      totalOrders: acc.totalOrders + ((row as { total_orders: number }).total_orders ?? 0),
      totalDelivered: acc.totalDelivered + ((row as { delivered_orders: number }).delivered_orders ?? 0),
    }),
    { totalOrders: 0, totalDelivered: 0 }
  );

  const daysInPeriod = data?.length || 1;

  return {
    capacityPct: totals.totalOrders > 0
      ? Math.round((totals.totalOrders / (daysInPeriod * DAILY_CAPACITY)) * 1000) / 10
      : null,
    capacityTarget: DAILY_CAPACITY,
    ordersPerHour: totals.totalOrders > 0
      ? Math.round((totals.totalOrders / (daysInPeriod * OPERATIONAL_HOURS)) * 10) / 10
      : null,
    totalOrders: totals.totalOrders,
    totalDelivered: totals.totalDelivered,
    daysInPeriod,
    operationalHours: OPERATIONAL_HOURS,
  };
}

export function useSecondaryMetrics(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'secondary-metrics', startDate, endDate],
    queryFn: () => fetchSecondaryMetrics(operatorId!, startDate, endDate),
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

export function useSecondaryMetricsPreviousPeriod(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'secondary-metrics-prev', startDate, endDate],
    queryFn: () => fetchSecondaryMetrics(operatorId!, startDate, endDate),
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

// === Story 3.7 hooks ===

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
  // Gate operatorId so inner hooks only fire when enabled
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
            fadrValue:
              fadrSummary.data && fadrSummary.data.total > 0
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

export function useFailureReasons(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'failure-reasons', startDate, endDate],
    queryFn: async () => {
      const args: FailureReasonsArgs = {
        p_operator_id: operatorId!,
        p_start_date: startDate,
        p_end_date: endDate,
      };
      const { data, error } = await (createSPAClient().rpc as CallableFunction)('get_failure_reasons', args);
      if (error) throw error;
      return data as FailureReasonRow[];
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}
