'use client';

interface CxTabProps {
  operatorId: string;
}

export default function CxTab({ operatorId: _ }: CxTabProps) {
  return (
    <div className="flex items-center justify-center h-64 text-slate-400" data-testid="cx-tab">
      <p className="text-lg">CX — Próximamente</p>
    </div>
  );
}
