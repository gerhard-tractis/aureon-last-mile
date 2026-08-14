'use client';

import { useMemo, useState } from 'react';
import { Loader2, Plus, Truck } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  useVehicles,
  useCreateVehicle,
  normalizePlate,
  RESERVED_PLATE,
  RESERVED_PLATE_MESSAGE,
  type Vehicle,
} from '@/hooks/pickup/useVehicles';

interface VehicleSelectProps {
  operatorId: string | null;
  /** Selected `vehicles.id`, or null when nothing is chosen yet. */
  value: string | null;
  onChange: (vehicleId: string | null) => void;
}

/**
 * Required vehicle picker for starting a pickup route: a combobox over the
 * operator's active vehicles, with inline "registrar patente" for a truck the
 * fleet does not know yet. Selection is by `vehicles.id` — the route carries a
 * real FK, never free text.
 */
export function VehicleSelect({ operatorId, value, onChange }: VehicleSelectProps) {
  const { data: vehicles = [], isLoading } = useVehicles(operatorId);
  const createMut = useCreateVehicle(operatorId);

  const [open, setOpen] = useState(false);
  /** null = not editing; the selected plate is displayed instead. */
  const [query, setQuery] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Vehicle | null>(null);

  const selected = useMemo(
    () => vehicles.find((v) => v.id === value) ?? (created?.id === value ? created : null),
    [vehicles, value, created],
  );

  const display = query ?? selected?.plate ?? '';
  const normalized = normalizePlate(query ?? '');

  const filtered = useMemo(() => {
    if (!normalized) return vehicles;
    return vehicles.filter((v) => v.plate.toUpperCase().includes(normalized));
  }, [vehicles, normalized]);

  const exactMatch = vehicles.some((v) => v.plate.toUpperCase() === normalized);
  const canRegister = normalized.length > 0 && !exactMatch;

  const select = (vehicle: Vehicle) => {
    setQuery(null);
    setError(null);
    setOpen(false);
    onChange(vehicle.id);
  };

  const handleRegister = async () => {
    setError(null);
    if (normalized === RESERVED_PLATE) {
      setError(RESERVED_PLATE_MESSAGE);
      return;
    }
    try {
      const vehicle = await createMut.mutateAsync({ plate: normalized });
      setCreated(vehicle);
      select(vehicle);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar la patente');
    }
  };

  return (
    <div className="space-y-2">
      <label htmlFor="vehicle-select" className="text-sm text-text-secondary">
        Vehículo
      </label>

      <Input
        id="vehicle-select"
        role="combobox"
        aria-expanded={open}
        aria-controls="vehicle-select-list"
        autoComplete="off"
        placeholder="Patente"
        value={display}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setError(null);
          setOpen(true);
          if (value) onChange(null);
        }}
      />

      {open && (
        <div
          id="vehicle-select-list"
          role="listbox"
          aria-label="Patentes disponibles"
          className="max-h-48 overflow-y-auto rounded-md border border-border divide-y divide-border"
        >
          {isLoading && (
            <p className="p-2 text-sm text-text-muted">Cargando vehículos…</p>
          )}

          {!isLoading && filtered.length === 0 && !canRegister && (
            <p className="p-2 text-sm text-text-muted">No hay vehículos activos</p>
          )}

          {filtered.map((v) => (
            <button
              key={v.id}
              type="button"
              role="option"
              aria-selected={v.id === value}
              onClick={() => select(v)}
              className="flex w-full items-center gap-2 p-2 text-left text-sm hover:bg-surface-hover"
            >
              <Truck className="h-4 w-4 text-text-muted" />
              <span className="font-medium">{v.plate}</span>
              {v.vehicle_type && (
                <span className="text-text-muted">· {v.vehicle_type}</span>
              )}
            </button>
          ))}

          {canRegister && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2"
              data-testid="register-plate-button"
              disabled={createMut.isPending}
              onClick={handleRegister}
            >
              {createMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Registrar patente {normalized}
            </Button>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}
