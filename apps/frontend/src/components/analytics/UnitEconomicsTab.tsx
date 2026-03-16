'use client';

interface UnitEconomicsTabProps {
  operatorId: string;
}

export default function UnitEconomicsTab({ operatorId: _ }: UnitEconomicsTabProps) {
  return (
    <div className="flex items-center justify-center h-64 text-muted-foreground" data-testid="unit-economics-tab">
      <p className="text-lg">Unit Economics — Próximamente</p>
    </div>
  );
}
