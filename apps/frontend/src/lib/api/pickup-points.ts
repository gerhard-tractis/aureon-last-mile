export interface PickupLocation {
  name: string;
  address: string;
  comuna?: string;
  contact_name?: string;
  contact_phone?: string;
}

export interface PickupPoint {
  id: string;
  operator_id: string;
  tenant_client_id: string;
  name: string;
  code: string;
  intake_method: string;
  pickup_locations: PickupLocation[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  client_name?: string; // joined from tenant_clients
}

export interface CreatePickupPointInput {
  name: string;
  code: string;
  tenant_client_id: string;
  pickup_locations: PickupLocation[];
}

export interface UpdatePickupPointInput {
  name?: string;
  code?: string;
  tenant_client_id?: string;
  pickup_locations?: PickupLocation[];
  is_active?: boolean;
}

export async function getPickupPoints(): Promise<PickupPoint[]> {
  const res = await fetch('/api/pickup-points');
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Failed to fetch pickup points');
  }
  return res.json();
}

export async function createPickupPoint(input: CreatePickupPointInput): Promise<PickupPoint> {
  const res = await fetch('/api/pickup-points', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Failed to create pickup point');
  }
  return res.json();
}

export async function updatePickupPoint(id: string, input: UpdatePickupPointInput): Promise<PickupPoint> {
  const res = await fetch(`/api/pickup-points/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Failed to update pickup point');
  }
  return res.json();
}

export async function deletePickupPoint(id: string): Promise<void> {
  const res = await fetch(`/api/pickup-points/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Failed to delete pickup point');
  }
}
