export default function CustomerDrill({ params }: { params?: unknown }) {
  const customer = params as string | undefined;
  return (
    <div className="p-6">
      <p className="text-sm text-muted-foreground">
        {customer ? `OTIF detalle para: ${customer}` : 'Selecciona un cliente'}
      </p>
    </div>
  );
}
