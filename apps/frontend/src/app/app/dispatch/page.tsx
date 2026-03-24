'use client';
import { useRouter } from 'next/navigation';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useDispatchRoutes } from '@/hooks/dispatch/useDispatchRoutes';
import { RouteListTile } from '@/components/dispatch/RouteListTile';
import { Skeleton } from '@/components/ui/skeleton';

export default function DispatchPage() {
  const router = useRouter();
  const { operatorId } = useOperatorId();
  const { data: routes, isLoading } = useDispatchRoutes(operatorId);

  const handleNewRoute = async () => {
    const res = await fetch('/api/dispatch/routes', { method: 'POST' });
    if (res.ok) {
      const json = await res.json();
      router.push(`/app/dispatch/${json.id}`);
    }
  };

  if (!operatorId || isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Despacho</h1>
        <button
          onClick={handleNewRoute}
          className="inline-flex items-center px-4 py-2 text-sm font-semibold rounded-md border"
          style={{ background: 'var(--color-accent)', color: 'var(--color-accent-foreground, #fff)', border: 'none', minHeight: 40, cursor: 'pointer' }}
        >
          + Nueva Ruta
        </button>
      </div>

      {(!routes || routes.length === 0) ? (
        <div className="text-center py-16 text-muted-foreground">
          No hay rutas abiertas hoy.{' '}
          <button
            onClick={handleNewRoute}
            className="underline"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
          >
            Crear primera ruta →
          </button>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 16,
          }}
        >
          {routes.map((route) => (
            <RouteListTile
              key={route.id}
              route={route}
              onClick={() => router.push(`/app/dispatch/${route.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
