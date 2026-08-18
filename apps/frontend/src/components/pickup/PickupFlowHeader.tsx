interface PickupFlowHeaderProps {
  loadId: string;
  /** Null until the manifest has loaded, or when the column is genuinely
   * unset — never a placeholder. */
  retailerName: string | null;
  pickupPoint: string | null;
  scanned: number;
  total: number;
  /**
   * spec-54 mock 1h — scans written to the device and not yet accepted by
   * the server (`useSyncQueue().queuedCount`). Zero is hidden rather than
   * shown as "COLA 0": a badge reading zero is still a claim about state,
   * and the handoff's rule is to neutralise it, not render it.
   *
   * Nothing writes to the underlying queue from this screen today (see the
   * comment on `sync` in page.tsx), so in practice this badge never fires
   * yet. It's also device-global — `useSyncQueue` counts every unsynced row
   * in `db.scan_queue` regardless of `manifest_id`/`operator_id`, so if a
   * writer is ever added it would need to filter, or this badge would count
   * other manifests'/operators' queued scans too.
   */
  queuedCount: number;
}

export function PickupFlowHeader({
  loadId,
  retailerName,
  pickupPoint,
  scanned,
  total,
  queuedCount,
}: PickupFlowHeaderProps) {
  // Floor, not round: 199/200 must read 99%, not a false 100% while a
  // package is still missing. The min-clamp still lets a true 100% (or an
  // over-scan) reach exactly 100.
  const pct = total > 0 ? Math.min(Math.floor((scanned / total) * 100), 100) : 0;
  const subtitle = [retailerName, pickupPoint].filter(Boolean).join(' · ');

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-heading text-[14px] font-semibold leading-tight text-text truncate">
            {loadId}
          </p>
          {subtitle && (
            <p
              data-testid="flow-header-subtitle"
              className="mt-0.5 text-[11px] leading-tight text-text-secondary truncate"
            >
              {subtitle}
            </p>
          )}
        </div>

        {queuedCount > 0 && (
          <span
            data-testid="queue-badge"
            className="flex-none rounded-full border border-status-warning-border bg-status-warning-bg px-2.5 py-1 font-mono text-[11px] font-semibold leading-none text-status-warning-text"
          >
            COLA {queuedCount}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        {/* text-accent-emphasis, not text-accent: the raw brand gold is
            ~2.6:1 on this white card, below the 3:1 floor for large text. */}
        <span className="font-mono text-[32px] font-bold leading-none text-accent-emphasis">
          {scanned}
        </span>
        <span className="text-sm text-text-secondary">de {total} paquetes</span>
        <span className="ml-auto font-mono text-sm font-semibold text-text-secondary">
          {pct}%
        </span>
      </div>

      {/* bg-border, not bg-surface-raised: the raised tint is nearly
          indistinguishable from this card's own white fill in light mode. */}
      <div className="mt-2 h-[9px] w-full overflow-hidden rounded-full bg-border">
        <div
          role="progressbar"
          aria-valuenow={scanned}
          aria-valuemin={0}
          aria-valuemax={total}
          className="h-[9px] rounded-full bg-accent transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
