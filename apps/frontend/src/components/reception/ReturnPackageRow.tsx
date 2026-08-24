import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * spec-54 phase 4.6 (mock 1k) — one row in the returns-reception list.
 *
 * DISPOSICIÓN (REINTENTO / GESTIÓN) OMITTED. The mock calls for a right-hand
 * disposition column, but no table or RPC in this codebase stores a
 * retry-vs-manage decision for a returned package — `packages` has
 * `return_reason` / `return_reason_code` (why it came back) and nothing that
 * models what happens to it next. Grep: `disposition|disposicion|reintento`
 * across packages/database/supabase/migrations and apps/frontend/src returns
 * nothing. Unblock by adding a column (or derived rule) that actually decides
 * retry vs. manual management, then wire it through useReturnReceptionSession.
 *
 * PER-ROW "SCANNING" HIGHLIGHT REMOVED. An earlier version guessed which
 * pending row was "being scanned" by taking the first not-yet-received item
 * in list order — that is not where the operator's scan actually lands (they
 * can scan any package, in any order), so it painted an accent border on the
 * wrong row while a real scan for a different package was in flight. The
 * scan-in-progress state now lives only on the scan field itself (its
 * `disabled` prop), which is the one place that state is actually true.
 */

interface ReturnPackageRowProps {
  label: string;
  orderNumber: string | null;
  returnReason: string | null;
  comuna: string | null;
  received: boolean;
}

export function ReturnPackageRow({
  label,
  orderNumber,
  returnReason,
  comuna,
  received,
}: ReturnPackageRowProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border p-3',
        received
          ? 'border-status-success-border bg-status-success-bg'
          : 'border-border bg-surface',
      )}
    >
      {received ? (
        // NOTE: in production this state is short-lived, not steady-state.
        // complete_return_reception_scan moves the package to
        // status='en_bodega', and loadPackagesForRoute filters
        // .eq('status','retorno_hub') — so a scanned package drops out of
        // this list on the very next refetch (the postgres_changes
        // subscription in the hook fires that refetch immediately). The
        // green check is visible only in the brief window between the scan
        // resolving and the invalidated query returning. Don't assume this
        // styling gets regular real-world exposure.
        <span
          data-testid="pkg-received"
          className="grid h-[26px] w-[26px] flex-none place-items-center rounded-md bg-status-success-chip text-status-success-chip-fg"
        >
          <Check className="h-4 w-4" strokeWidth={3} />
        </span>
      ) : (
        <span
          data-testid="pkg-pending"
          className="h-[26px] w-[26px] flex-none rounded-md border-2 border-border-strong"
        />
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-[12px] font-semibold leading-none text-text">
          {label}
        </p>
        <p className="mt-0.5 truncate text-[10px] leading-none text-text-muted">
          {orderNumber ?? '(orden desconocida)'}
        </p>
        <p data-testid="pkg-reason-line" className="mt-1 truncate text-[11px] leading-none text-text-secondary">
          {returnReason ?? 'Motivo no registrado'}
          {comuna && ` · ${comuna}`}
        </p>
      </div>
    </div>
  );
}
