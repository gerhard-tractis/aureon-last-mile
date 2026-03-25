'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { DiscrepancyItem } from '@/components/pickup/DiscrepancyItem';
import { usePickupScans } from '@/hooks/pickup/usePickupScans';
import {
  useMissingPackages,
  useDiscrepancyNotes,
  useSaveDiscrepancyNote,
} from '@/hooks/pickup/useDiscrepancies';
import { useOperatorId } from '@/hooks/useOperatorId';
import { createSPAClient } from '@/lib/supabase/client';
import { CheckCircle, XCircle, AlertTriangle, ArrowLeft } from 'lucide-react';
import { PickupStepBreadcrumb } from '@/components/pickup/PickupStepBreadcrumb';
import { MetricCard } from '@/components/metrics/MetricCard';
import { Skeleton } from '@/components/ui/skeleton';

export default function DiscrepancyReviewPage() {
  const params = useParams();
  const router = useRouter();
  const loadId = decodeURIComponent(params.loadId as string);
  const { operatorId } = useOperatorId();

  const [manifestId, setManifestId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!operatorId) return;
    const supabase = createSPAClient();
    supabase
      .from('manifests')
      .select('id')
      .eq('operator_id', operatorId)
      .eq('external_load_id', loadId)
      .is('deleted_at', null)
      .single()
      .then(({ data }) => {
        if (data) setManifestId(data.id);
      });
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
    });
  }, [operatorId, loadId]);

  const { data: scans = [] } = usePickupScans(manifestId, operatorId);
  const { data: missingPackages = [] } = useMissingPackages(
    operatorId,
    loadId,
    manifestId
  );
  const { data: notes = [] } = useDiscrepancyNotes(manifestId);
  const saveNote = useSaveDiscrepancyNote();

  const verifiedCount = useMemo(
    () => scans.filter((s) => s.scan_result === 'verified').length,
    [scans]
  );
  const notFoundScans = useMemo(
    () => scans.filter((s) => s.scan_result === 'not_found'),
    [scans]
  );

  const noteMap = useMemo(
    () => new Map(notes.map((n) => [n.package_id, n.note])),
    [notes]
  );

  const allNotesComplete = useMemo(
    () =>
      missingPackages.length === 0 ||
      missingPackages.every((p) => {
        const existingNote = noteMap.get(p.id);
        return existingNote && existingNote.trim().length > 0;
      }),
    [missingPackages, noteMap]
  );

  const handleSaveNote = (packageId: string, note: string) => {
    if (!operatorId || !manifestId || !userId) return;
    saveNote.mutate({
      operatorId,
      manifestId,
      packageId,
      note,
      userId,
    });
  };

  if (!manifestId) {
    return (
      <div className="space-y-4 p-4 sm:p-6 max-w-2xl mx-auto">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-3 gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 sm:p-6 max-w-2xl mx-auto">
      <PickupStepBreadcrumb current="review" />

      {/* Gold header */}
      <div className="bg-accent text-accent-foreground dark:bg-accent-muted dark:text-accent p-4 -mx-4 rounded-none">
        <p className="text-xs opacity-80">{loadId}</p>
        <p className="font-semibold text-base mt-0.5">Revisión</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <MetricCard icon={CheckCircle} label="Verificados" value={verifiedCount} />
        <MetricCard icon={XCircle} label="Faltantes" value={missingPackages.length} />
        <MetricCard icon={AlertTriangle} label="No en manifiesto" value={notFoundScans.length} />
      </div>

      {/* Missing Packages — notes required */}
      {missingPackages.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-text">
            Faltantes — notas obligatorias ({missingPackages.length})
          </h2>
          {missingPackages.map((pkg) => (
            <DiscrepancyItem
              key={pkg.id}
              packageId={pkg.id}
              packageLabel={pkg.label}
              orderNumber={pkg.order_number}
              existingNote={noteMap.get(pkg.id) ?? ''}
              onSaveNote={handleSaveNote}
            />
          ))}
        </div>
      )}

      {/* Not in Manifest scans — informational */}
      {notFoundScans.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-text">
            No en manifiesto ({notFoundScans.length})
          </h2>
          {notFoundScans.map((scan) => (
            <div
              key={scan.id}
              className="flex items-center gap-2 p-2 bg-status-warning-bg border border-status-warning-border rounded-lg"
            >
              <AlertTriangle className="h-4 w-4 text-status-warning" />
              <span className="font-mono text-sm text-text">{scan.barcode_scanned}</span>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <Button
          variant="outline"
          onClick={() =>
            router.push(`/app/pickup/scan/${encodeURIComponent(loadId)}`)
          }
          className="flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver
        </Button>
        <Button
          onClick={() =>
            router.push(`/app/pickup/handoff/${encodeURIComponent(loadId)}`)
          }
          disabled={!allNotesComplete}
          className="flex-1 disabled:opacity-50"
        >
          Continuar a entrega
        </Button>
      </div>
    </div>
  );
}
