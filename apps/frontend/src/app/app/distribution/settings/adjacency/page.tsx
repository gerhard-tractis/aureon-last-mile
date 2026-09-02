'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useDockZones } from '@/hooks/distribution/useDockZones';
import { DockZoneAdjacencyList } from '@/components/distribution/DockZoneAdjacencyList';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * spec-73 Phase 3 — Adyacencia de Andenes settings screen.
 *
 * Flat table only — no map, no drag-and-drop (spec Non-Goal). Lists live
 * dock_zone_adjacency pairs (deduplicated — see useDockZoneAdjacencyPairs),
 * lets a manager add or remove one. See DockZoneAdjacencyList for the role
 * gate and the atomic-both-directions write/remove.
 */
export default function DockZoneAdjacencySettingsPage() {
  const router = useRouter();
  const { operatorId, role } = useOperatorId();
  const { data: zones, isLoading } = useDockZones(operatorId);

  if (isLoading) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <div className="mb-6 flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push('/app/distribution/settings')}
          aria-label="Volver a Configuración de Andenes"
        >
          <ArrowLeft className="h-5 w-5 text-text-secondary" />
        </Button>
        <h1 className="text-xl font-semibold">Adyacencia de Andenes</h1>
      </div>

      <DockZoneAdjacencyList
        operatorId={operatorId ?? ''}
        zones={(zones ?? []).filter((z) => !z.is_consolidation)}
        role={role}
      />
    </div>
  );
}
