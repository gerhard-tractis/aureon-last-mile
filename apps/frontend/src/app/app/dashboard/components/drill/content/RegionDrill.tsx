export default function RegionDrill({ params }: { params?: unknown }) {
  const region = params as string | undefined;
  return (
    <div className="p-6">
      <p className="text-sm text-muted-foreground">
        {region ? `OTIF detalle para: ${region}` : 'Selecciona una región'}
      </p>
    </div>
  );
}
