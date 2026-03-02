'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface SLADrillDownDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SLADrillDownDialog({
  open,
  onOpenChange,
}: SLADrillDownDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Analisis Detallado de SLA</DialogTitle>
          <DialogDescription>Proximamente disponible</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 text-slate-700">
          <li>Desglose horario</li>
          <li>Rendimiento por comuna/zona</li>
          <li>Rendimiento por conductor</li>
        </ul>
      </DialogContent>
    </Dialog>
  );
}
