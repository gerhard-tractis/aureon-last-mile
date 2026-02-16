/**
 * Users API Client Tests
 * Tests API client functions for user management
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getUsers, createUser, updateUser, deleteUser } from './users';
import type { User, CreateUserInput, UpdateUserInput } from './users';

describe('Users API Client', () => {
  const mockUser: User = {
    id: '123',
    email: 'test@example.com',
    full_name: 'Test User',
    role: 'admin',
    operator_id: 'op-1',
    created_at: '2026-02-16T14:30:00Z',
    deleted_at: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset fetch mock
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getUsers', () => {
    it('should fetch users successfully', async () => {
      const mockUsers = [mockUser];
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockUsers,
      });

      const result = await getUsers();

      expect(global.fetch).toHaveBeenCalledWith('/api/users', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store', // Expect cache option
      });
      expect(result).toEqual(mockUsers);
    });

    it('should throw error when fetch fails', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ message: 'Internal server error' }),
      });

      await expect(getUsers()).rejects.toThrow('Internal server error');
    });

    it('should throw generic error when response has no message', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      });

      await expect(getUsers()).rejects.toThrow('Failed to fetch users');
    });

    it('should handle network errors', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      await expect(getUsers()).rejects.toThrow('Network error');
    });
  });

  describe('createUser', () => {
    const createUserData: CreateUserInput = {
      email: 'newuser@example.com',
      full_name: 'New User',
      role: 'pickup_crew',
      operator_id: 'op-1',
    };

    it('should create user successfully', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockUser,
      });

      const result = await createUser(createUserData);

      expect(global.fetch).toHaveBeenCalledWith('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createUserData),
      });
      expect(result).toEqual(mockUser);
    });

    it('should throw error when email already exists', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ message: 'User with this email already exists' }),
      });

      await expect(createUser(createUserData)).rejects.toThrow(
        'User with this email already exists'
      );
    });

    it('should throw error when unauthorized', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Unauthorized' }),
      });

      await expect(createUser(createUserData)).rejects.toThrow('Unauthorized');
    });

    it('should throw error when validation fails', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Invalid email format' }),
      });

      await expect(createUser(createUserData)).rejects.toThrow('Invalid email format');
    });

    it('should throw generic error when response has no message', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      });

      await expect(createUser(createUserData)).rejects.toThrow('Failed to create user');
    });
  });

  describe('updateUser', () => {
    const userId = '123';
    const updateUserData: UpdateUserInput = {
      full_name: 'Updated User',
      role: 'operations_manager',
    };

    it('should update user successfully', async () => {
      const updatedUser = { ...mockUser, ...updateUserData };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => updatedUser,
      });

      const result = await updateUser(userId, updateUserData);

      expect(global.fetch).toHaveBeenCalledWith('/api/users/123', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateUserData),
      });
      expect(result.full_name).toBe('Updated User');
      expect(result.role).toBe('operations_manager');
    });

    it('should throw error when user not found', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ message: 'User not found' }),
      });

      await expect(updateUser(userId, updateUserData)).rejects.toThrow('User not found');
    });

    it('should throw error when updating user from different operator', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ code: 'FORBIDDEN', message: 'Forbidden' }),
      });

      await expect(updateUser(userId, updateUserData)).rejects.toThrow(
        'Cannot edit users from other operators'
      );
    });

    it('should throw error when trying to change last admin role', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          message: 'Cannot change role: must have at least one admin',
        }),
      });

      await expect(updateUser(userId, updateUserData)).rejects.toThrow(
        'Cannot change role: must have at least one admin'
      );
    });

    it('should throw generic error when response has no message', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      });

      await expect(updateUser(userId, updateUserData)).rejects.toThrow('Failed to update user');
    });
  });

  describe('deleteUser', () => {
    const userId = '123';

    it('should delete user successfully', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ message: 'User deleted successfully' }),
      });

      await deleteUser(userId);

      expect(global.fetch).toHaveBeenCalledWith('/api/users/123', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });
    });

    it('should throw error when user not found', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ message: 'User not found' }),
      });

      await expect(deleteUser(userId)).rejects.toThrow('User not found');
    });

    it('should throw error when deleting user from different operator', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ code: 'FORBIDDEN', message: 'Forbidden' }),
      });

      await expect(deleteUser(userId)).rejects.toThrow(
        'Cannot delete users from other operators'
      );
    });

    it('should throw error when trying to delete last admin', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ code: 'LAST_ADMIN', message: 'Cannot delete last admin' }),
      });

      await expect(deleteUser(userId)).rejects.toThrow(
        'Cannot delete the last admin user'
      );
    });

    it('should throw generic error when response has no message', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      });

      await expect(deleteUser(userId)).rejects.toThrow('Failed to delete user');
    });
  });

  describe('Error Response Handling', () => {
    it('should handle malformed JSON responses', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      await expect(getUsers()).rejects.toThrow('Invalid JSON');
    });

    it('should handle null responses safely', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => null,
      });

      // Should not crash, should use fallback error message
      await expect(getUsers()).rejects.toThrow('Failed to fetch users');
    });

    it('should handle empty object responses', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      });

      await expect(getUsers()).rejects.toThrow('Failed to fetch users');
    });
  });

  describe('Request Headers', () => {
    it('should always include Content-Type header in POST', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockUser,
      });

      await createUser({
        email: 'test@example.com',
        full_name: 'Test',
        role: 'admin',
        operator_id: 'op-1',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should include Content-Type header in DELETE', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      await deleteUser('123');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });
  });

  describe('Type Safety', () => {
    it('should return properly typed User objects', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [mockUser],
      });

      const users = await getUsers();

      // TypeScript should enforce these properties exist
      expect(users[0].id).toBeDefined();
      expect(users[0].email).toBeDefined();
      expect(users[0].full_name).toBeDefined();
      expect(users[0].role).toBeDefined();
      expect(users[0].operator_id).toBeDefined();
      expect(users[0].created_at).toBeDefined();
    });
  });
});
