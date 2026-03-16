interface ProgressBarProps {
  scanned: number;
  total: number;
}

export function ProgressBar({ scanned, total }: ProgressBarProps) {
  const percentage = total > 0 ? Math.min((scanned / total) * 100, 100) : 0;

  const getColor = () => {
    if (percentage >= 90) return 'bg-green-500';
    if (percentage >= 50) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm text-muted-foreground">
        <span>
          {scanned} / {total} packages
        </span>
        <span>{Math.round(percentage)}%</span>
      </div>
      <div className="h-3 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${getColor()}`}
          style={{ width: `${percentage}%` }}
          role="progressbar"
          aria-valuenow={scanned}
          aria-valuemin={0}
          aria-valuemax={total}
        />
      </div>
    </div>
  );
}
