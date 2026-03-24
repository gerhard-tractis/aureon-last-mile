interface UnmappedComunasBannerProps {
  unmappedComunas: string[];
}

export function UnmappedComunasBanner({ unmappedComunas }: UnmappedComunasBannerProps) {
  if (unmappedComunas.length === 0) return null;

  return (
    <div className="rounded-md border border-status-warning-border bg-status-warning-bg p-4">
      <p className="text-sm font-medium text-status-warning">
        Comunas sin andén asignado:
      </p>
      <div className="flex flex-wrap gap-1 mt-2">
        {unmappedComunas.map((c) => (
          <span key={c} className="text-xs bg-status-warning-bg text-status-warning px-2 py-0.5 rounded-full">{c}</span>
        ))}
      </div>
    </div>
  );
}
