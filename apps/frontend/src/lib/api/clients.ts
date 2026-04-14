export interface Client {
  id: string;
  operator_id: string;
  name: string;
  slug: string;
  connector_type: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  pickup_point_count?: number;
}

export interface CreateClientInput {
  name: string;
}

export interface UpdateClientInput {
  name?: string;
  is_active?: boolean;
}

export async function getClients(): Promise<Client[]> {
  const res = await fetch('/api/clients');
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Failed to fetch clients');
  }
  return res.json();
}

export async function createClient(input: CreateClientInput): Promise<Client> {
  const res = await fetch('/api/clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Failed to create client');
  }
  return res.json();
}

export async function updateClient(id: string, input: UpdateClientInput): Promise<Client> {
  const res = await fetch(`/api/clients/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Failed to update client');
  }
  return res.json();
}

export async function deleteClient(id: string): Promise<void> {
  const res = await fetch(`/api/clients/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Failed to delete client');
  }
}
