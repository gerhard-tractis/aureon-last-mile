'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { UnverifiedPackagesBlock } from '@/components/pickup/UnverifiedPackagesBlock';
import { usePickupScans } from '@/hooks/pickup/usePickupScans';
import {
  useMissingPackages,
  useDiscrepancyNotes,
  useSaveDiscrepancyNote,
} from '@/hooks/pickup/useDiscrepancies';
import {
  computeReviewCounts,
  dedupeNotFoundBarcodes,
  allMissingNotesComplete,
  closeButtonLabel,
} from '@/lib/pickup/reviewCloseGate';
import { useOperatorId } from '@/hooks/useOperatorId';
import { createSPAClient } from '@/lib/supabase/client';
import { ArrowLeft } from 'lucide-react';
import { PickupStepBreadcrumb } from '@/components/pickup/PickupStepBreadcrumb';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * spec-80 fase 2, mock `5e`. Replaces spec-47's review screen at the same
 * point in the flow: no longer just informational — it is the "el bloqueo
 * que faltaba en 5d" the mock's own label calls it. A missing package
 * without a note keeps the crew here; the client signs on `5f` over
 * whatever counts leave this screen.
 */
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

  const notFoundBarcodes = useMemo(() => dedupeNotFoundBarcodes(scans), [scans]);

  const counts = useMemo(
    () => computeReviewCounts(scans, missingPackages.length),
    [scans, missingPackages.length]
  );

  const noteMap = useMemo(
    () => new Map(notes.map((n) => [n.package_id, n.note])),
    [notes]
  );

  const canClose = useMemo(
    () =>
      allMissingNotesComplete(
        missingPackages.map((p) => p.id),
        noteMap
      ),
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

  const goToFirma = () => {
    if (!canClose) return;
    router.push(`/app/pickup/complete/${encodeURIComponent(loadId)}`);
  };

  if (!manifestId) {
    return (
      <div className="space-y-4 p-4 sm:p-6 max-w-2xl mx-auto">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4 p-4 sm:p-6 pb-24 max-w-2xl mx-auto">
        <PickupStepBreadcrumb current="review" />

        {/* Gold header */}
        <div className="bg-accent text-accent-foreground dark:bg-accent-muted dark:text-accent p-4 -mx-4 rounded-none">
          <p className="text-xs opacity-80">{loadId}</p>
          <p className="font-semibold text-base mt-0.5">
            Faltan {counts.missingCount} paquetes
          </p>
          <p className="text-xs opacity-80 mt-0.5">
            {counts.verifiedCount} de {counts.totalCount} verificados
          </p>
        </div>

        <UnverifiedPackagesBlock
          missingPackages={missingPackages}
          notFoundBarcodes={notFoundBarcodes}
          noteMap={noteMap}
          onSaveNote={handleSaveNote}
        />
      </div>

      {/* Sticky footer — always visible on tablet/mobile */}
      <div className="fixed bottom-0 inset-x-0 bg-background border-t border-border p-4 sm:p-6">
        <div className="max-w-2xl mx-auto flex gap-3">
          <Button
            variant="outline"
            onClick={() =>
              router.push(`/app/pickup/scan/${encodeURIComponent(loadId)}`)
            }
            className="flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Seguir escaneando
          </Button>
          <Button
            onClick={goToFirma}
            disabled={!canClose}
            className="flex-1 disabled:opacity-50"
          >
            {closeButtonLabel(counts.missingCount)}
          </Button>
        </div>
      </div>
    </>
  );
}
