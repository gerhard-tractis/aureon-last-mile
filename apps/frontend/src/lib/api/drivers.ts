/**
 * Drivers API Client — spec-84 fase 1
 * Type-safe API client for the minimal admin surface that links a
 * public.users account to a public.drivers row (drivers.user_id).
 */

export interface LinkedUser {
  id: string;
  email: string;
  full_name: string;
}

export interface Driver {
  id: string;
  operator_id: string;
  full_name: string;
  phone: string;
  rut: string | null;
  fleet_type: 'own' | 'external';
  status: string;
  user_id: string | null;
  users: LinkedUser | null;
}

export interface LinkedDriver {
  id: string;
  user_id: string | null;
}

/**
 * Fetch all drivers for the authenticated user's operator, with the linked
 * user (if any) embedded.
 * GET /api/admin/drivers
 */
export const getDrivers = async (): Promise<Driver[]> => {
  const response = await fetch('/api/admin/drivers', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error?.message || 'Failed to fetch drivers');
  }

  return response.json();
};

/**
 * Link (userId) or unlink (null) a driver's user_id.
 * PATCH /api/admin/drivers/[id]
 */
export const linkDriverUser = async (driverId: string, userId: string | null): Promise<LinkedDriver> => {
  const response = await fetch(`/api/admin/drivers/${driverId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error?.message || 'Failed to update driver');
  }

  return response.json();
};
