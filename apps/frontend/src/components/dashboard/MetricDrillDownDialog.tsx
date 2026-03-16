'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface MetricDrillDownDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children?: React.ReactNode;
}

export default function MetricDrillDownDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: MetricDrillDownDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children ?? (
          <p className="text-sm text-muted-foreground">Proximamente disponible</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
