import type { RoutePackage } from '@/lib/dispatch/types';

interface Props {
  index: number;
  pkg: RoutePackage;
  onRemove: (dispatchId: string) => void;
}

const STATUS_LABELS: Record<string, string> = {
  en_carga: 'En carga',
  listo_para_despacho: 'Listo',
  en_ruta: 'En ruta',
};

export function PackageRow({ index, pkg, onRemove }: Props) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        background: 'var(--color-surface)', border: '1px solid var(--color-border)',
        borderRadius: 10, padding: '0 14px', minHeight: 60, marginBottom: 8,
      }}
    >
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-text-muted)', width: 22, textAlign: 'right' }}>
        {index}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-accent)' }}>
          {pkg.order_number}
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
          {pkg.contact_name ?? '—'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {pkg.contact_address ?? '—'}
        </div>
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)' }}>
        {STATUS_LABELS[pkg.package_status] ?? pkg.package_status}
      </span>
      <button
        onClick={() => onRemove(pkg.dispatch_id)}
        aria-label="Eliminar paquete"
        style={{
          width: 44, height: 44, borderRadius: 8, border: 'none', cursor: 'pointer',
          background: 'transparent', color: 'var(--color-text-muted)', fontSize: 18,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        ✕
      </button>
    </div>
  );
}
