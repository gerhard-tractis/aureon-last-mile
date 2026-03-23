interface PickupFlowHeaderProps {
  loadId: string;
  scanned: number;
  total: number;
}

export function PickupFlowHeader({ loadId, scanned, total }: PickupFlowHeaderProps) {
  const pct = total > 0 ? Math.min((scanned / total) * 100, 100) : 0;

  return (
    <div className="bg-accent text-accent-foreground p-4 -mx-4 -mt-4 mb-4">
      <p className="text-xs opacity-80">{loadId}</p>
      <p className="font-mono text-xl font-bold">{scanned} / {total}</p>
      <div className="bg-white/20 rounded h-1.5 mt-2">
        <div
          role="progressbar"
          aria-valuenow={scanned}
          aria-valuemin={0}
          aria-valuemax={total}
          className="bg-white h-1.5 rounded transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
