'use client';
import type { FleetVehicle } from '@/lib/dispatch/types';

interface Props {
  packageCount: number;
  vehicles: FleetVehicle[];
  selectedVehicle: string;
  driverName: string;
  routeClosed: boolean;
  dispatching: boolean;
  dispatchError: string | null;
  onVehicleChange: (v: string) => void;
  onDriverChange: (v: string) => void;
  onClose: () => void;
  onDispatch: () => void;
  onRetry: () => void;
}

export function RoutePanel({
  packageCount, vehicles, selectedVehicle, driverName, routeClosed,
  dispatching, dispatchError, onVehicleChange, onDriverChange, onClose, onDispatch, onRetry,
}: Props) {
  return (
    <div style={{ width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--color-surface)', borderLeft: '1.5px solid var(--color-border)' }}>
      <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--color-border)' }}>
        <h3 style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 14 }}>
          Vehículo
        </h3>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 6 }}>Camión</div>
          <select
            value={selectedVehicle}
            onChange={(e) => onVehicleChange(e.target.value)}
            disabled={routeClosed}
            style={{ width: '100%', minHeight: 52, background: 'var(--color-background)', border: '1.5px solid var(--color-border)', borderRadius: 10, color: 'var(--color-text)', fontSize: 15, padding: '0 14px', cursor: 'pointer', outline: 'none' }}
          >
            <option value="">Seleccionar camión…</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.external_vehicle_id}>
                {v.external_vehicle_id}{v.plate_number ? ` · ${v.plate_number}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 6 }}>Conductor (opcional)</div>
          <input
            value={driverName}
            onChange={(e) => onDriverChange(e.target.value)}
            disabled={routeClosed}
            placeholder="Nombre o RUT…"
            style={{ width: '100%', minHeight: 52, background: 'var(--color-background)', border: '1.5px solid var(--color-border)', borderRadius: 10, color: 'var(--color-text)', fontSize: 15, padding: '0 14px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
          />
        </div>
      </div>
      <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--color-border)' }}>
        <h3 style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 14 }}>
          Resumen
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {(['Paquetes', 'Órdenes'] as const).map((label) => (
            <div key={label} style={{ background: 'var(--color-surface-raised)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: 'var(--color-text)' }}>{packageCount}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 1 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 'auto', padding: '16px 20px', borderTop: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {dispatchError && (
          <div style={{ background: 'color-mix(in srgb, #e53e3e 10%, transparent)', border: '1px solid color-mix(in srgb, #e53e3e 30%, transparent)', color: '#e53e3e', padding: '10px 14px', borderRadius: 8, fontSize: 12 }}>
            ⚠ {dispatchError}{' '}
            <button onClick={onRetry} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e53e3e', textDecoration: 'underline', fontSize: 12 }}>Reintentar</button>
          </div>
        )}
        <button
          onClick={onClose}
          disabled={routeClosed || packageCount === 0}
          style={{ width: '100%', minHeight: 52, borderRadius: 10, background: 'var(--color-surface-raised)', border: '1.5px solid var(--color-border)', color: 'var(--color-text-secondary, var(--color-text))', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
        >
          Cerrar Ruta
        </button>
        <button
          onClick={onDispatch}
          disabled={!routeClosed || !selectedVehicle || dispatching}
          style={{ width: '100%', minHeight: 56, borderRadius: 10, border: 'none', background: 'var(--color-accent)', color: 'var(--color-accent-foreground, #fff)', fontSize: 16, fontWeight: 800, cursor: 'pointer', opacity: (!routeClosed || !selectedVehicle || dispatching) ? 0.4 : 1 }}
        >
          {dispatching ? 'Despachando…' : 'Despachar a DispatchTrack →'}
        </button>
      </div>
    </div>
  );
}
