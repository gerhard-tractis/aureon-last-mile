'use client';

import { useDrivers, useLinkDriverUser } from '@/hooks/useDrivers';
import { useUsers } from '@/hooks/useUsers';

/**
 * DriverManagementPage — spec-84 fase 1's minimal admin surface for
 * drivers.user_id. One row per driver, one <select> per row to link/unlink
 * the public.users account. No create/edit/delete of drivers themselves —
 * that's a different surface, out of this phase's scope.
 */
export const DriverManagementPage = () => {
  const { data: drivers, isLoading: isLoadingDrivers } = useDrivers();
  const { data: users, isLoading: isLoadingUsers } = useUsers();
  const { mutate: linkDriverUser, isPending } = useLinkDriverUser();

  const handleChange = (driverId: string, value: string) => {
    linkDriverUser({ driverId, userId: value === '' ? null : value });
  };

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Conductores</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Vincular la cuenta de un usuario a un conductor (drivers.user_id).
          </p>
        </div>

        {(isLoadingDrivers || isLoadingUsers) && (
          <p className="text-muted-foreground">Cargando…</p>
        )}

        {!isLoadingDrivers && !isLoadingUsers && (
          <table className="w-full border border-border rounded-lg overflow-hidden">
            <thead className="bg-muted">
              <tr>
                <th className="text-left p-3 text-sm font-medium">Nombre</th>
                <th className="text-left p-3 text-sm font-medium">Teléfono</th>
                <th className="text-left p-3 text-sm font-medium">Estado</th>
                <th className="text-left p-3 text-sm font-medium">Vínculo</th>
                <th className="text-left p-3 text-sm font-medium">Cambiar vínculo</th>
              </tr>
            </thead>
            <tbody>
              {(drivers ?? []).map((driver) => (
                <tr key={driver.id} className="border-t border-border">
                  <td className="p-3">{driver.full_name}</td>
                  <td className="p-3">{driver.phone}</td>
                  <td className="p-3">{driver.status}</td>
                  <td className="p-3">
                    {driver.users ? `${driver.users.full_name} (${driver.users.email})` : 'Sin vincular'}
                  </td>
                  <td className="p-3">
                    <select
                      aria-label={`Usuario vinculado a ${driver.full_name}`}
                      value={driver.user_id ?? ''}
                      disabled={isPending}
                      onChange={(e) => handleChange(driver.id, e.target.value)}
                      className="border border-border rounded px-2 py-1 bg-card"
                    >
                      <option value="">— Desvincular —</option>
                      {(users ?? []).map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.full_name} ({user.email})
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
