/**
 * Users API Client
 * Type-safe API client for user management endpoints
 */

export interface CreateUserInput {
  email: string;
  full_name: string;
  role: 'pickup_crew' | 'warehouse_staff' | 'loading_crew' | 'operations_manager' | 'admin';
  operator_id: string;
}

export interface UpdateUserInput {
  full_name?: string;
  role?: 'pickup_crew' | 'warehouse_staff' | 'loading_crew' | 'operations_manager' | 'admin';
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: string;
  operator_id: string;
  created_at: string;
  deleted_at: string | null;
}

export interface UserWithRoleChanged extends User {
  roleChanged?: boolean;
}

/**
 * Fetch all users for the authenticated user's operator
 * GET /api/users
 */
export const getUsers = async (): Promise<User[]> => {
  const response = await fetch('/api/users', {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json'
    },
    cache: 'no-store' // Disable caching for fresh data
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch users');
  }

  return response.json();
};

/**
 * Create a new user
 * POST /api/users
 */
export const createUser = async (data: CreateUserInput): Promise<User> => {
  const response = await fetch('/api/users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to create user');
  }

  return response.json();
};

/**
 * Update an existing user
 * PUT /api/users/[id]
 */
export const updateUser = async (id: string, data: UpdateUserInput): Promise<UserWithRoleChanged> => {
  const response = await fetch(`/api/users/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const error = await response.json();

    // Map error codes to user-friendly messages
    if (error.code === 'FORBIDDEN') {
      throw new Error('Cannot edit users from other operators');
    } else if (error.code === 'NOT_FOUND') {
      throw new Error('User not found');
    }

    throw new Error(error.message || 'Failed to update user');
  }

  return response.json();
};

/**
 * Delete a user (soft delete)
 * DELETE /api/users/[id]
 */
export const deleteUser = async (id: string): Promise<void> => {
  const response = await fetch(`/api/users/${id}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const error = await response.json();

    if (error.code === 'FORBIDDEN') {
      throw new Error('Cannot delete users from other operators');
    } else if (error.code === 'LAST_ADMIN') {
      throw new Error('Cannot delete the last admin user');
    }

    throw new Error(error.message || 'Failed to delete user');
  }
};
