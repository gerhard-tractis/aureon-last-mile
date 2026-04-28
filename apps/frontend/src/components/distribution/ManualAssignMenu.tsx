'use client';
import { MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import type { DockZone } from '@/lib/distribution/sectorization-engine';

interface ManualAssignMenuProps {
  packageId: string;
  activeZones: DockZone[];
  onSelect: (zoneId: string) => void;
}

export function ManualAssignMenu({
  activeZones,
  onSelect,
}: ManualAssignMenuProps) {
  const andens = activeZones.filter(z => z.is_active && !z.is_consolidation);
  const consolidation = activeZones.find(z => z.is_active && z.is_consolidation);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label="Asignar manualmente"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Asignar manualmente</DropdownMenuLabel>
        {andens.map(zone => (
          <DropdownMenuItem key={zone.id} onSelect={() => onSelect(zone.id)}>
            <span className="font-mono text-xs text-muted-foreground mr-2">
              {zone.code}
            </span>
            {zone.name}
          </DropdownMenuItem>
        ))}
        {consolidation && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              key={consolidation.id}
              onSelect={() => onSelect(consolidation.id)}
            >
              <span className="font-mono text-xs text-muted-foreground mr-2">
                {consolidation.code}
              </span>
              {consolidation.name}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
