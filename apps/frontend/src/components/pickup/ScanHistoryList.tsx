import { CheckCircle, XCircle, Copy } from 'lucide-react';
import type { ScanRecord } from '@/hooks/pickup/usePickupScans';

interface ScanHistoryListProps {
  scans: ScanRecord[];
  maxItems?: number;
}

const ICONS = {
  verified: <CheckCircle className="h-5 w-5 text-green-500" />,
  not_found: <XCircle className="h-5 w-5 text-red-500" />,
  duplicate: <Copy className="h-5 w-5 text-yellow-500" />,
} as const;

export function ScanHistoryList({ scans, maxItems = 5 }: ScanHistoryListProps) {
  const recentScans = scans.slice(0, maxItems);

  if (recentScans.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">No scans yet</p>
    );
  }

  return (
    <div className="space-y-2">
      {recentScans.map((scan) => (
        <div
          key={scan.id}
          className="flex items-center gap-3 p-2 bg-muted rounded-md"
        >
          {ICONS[scan.scan_result]}
          <span className="font-mono text-sm flex-1">
            {scan.barcode_scanned}
          </span>
          <span className="text-xs text-muted-foreground">
            {new Date(scan.scanned_at).toLocaleTimeString()}
          </span>
        </div>
      ))}
    </div>
  );
}
