interface UnmappedComunasBannerProps {
  unmappedComunas: string[];
}

export function UnmappedComunasBanner({ unmappedComunas }: UnmappedComunasBannerProps) {
  if (unmappedComunas.length === 0) return null;

  return (
    <div className="rounded-md border border-yellow-200 bg-yellow-50 p-4">
      <p className="text-sm font-medium text-yellow-800">
        Comunas sin andén asignado:
      </p>
      <div className="flex flex-wrap gap-1 mt-2">
        {unmappedComunas.map((c) => (
          <span key={c} className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full">{c}</span>
        ))}
      </div>
    </div>
  );
}
