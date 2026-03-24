import type { DispatchRoute } from '@/lib/dispatch/types';

interface Props {
  route: DispatchRoute;
  onClick: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  planned: 'Planned',
};

export function RouteListTile({ route, onClick }: Props) {
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      style={{
        background: 'var(--color-surface)',
        border: '1.5px solid var(--color-border)',
        borderRadius: 14, padding: '18px 20px', cursor: 'pointer', minHeight: 130,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, color: 'var(--color-accent)' }}>
            {route.id.slice(0, 8).toUpperCase()}
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
            {route.driver_name ?? 'Sin conductor'}
          </div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: 'var(--color-surface-raised)', color: 'var(--color-text-muted)' }}>
          {STATUS_LABELS[route.status] ?? route.status}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: 'var(--color-text)' }}>
          {route.planned_stops} <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 400 }}>paquetes</span>
        </span>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          {new Date(route.created_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
}
