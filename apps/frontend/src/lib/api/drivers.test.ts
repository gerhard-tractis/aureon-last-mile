/**
 * Drivers API Client Tests — spec-84 fase 1
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDrivers, linkDriverUser } from './drivers';
import type { Driver } from './drivers';

describe('Drivers API Client', () => {
  const mockDriver: Driver = {
    id: 'd1',
    operator_id: 'op-1',
    full_name: 'Driver Uno',
    phone: '+56911111101',
    rut: '11.111.111-1',
    fleet_type: 'own',
    status: 'active',
    user_id: null,
    users: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getDrivers', () => {
    it('fetches drivers successfully', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [mockDriver],
      });

      const result = await getDrivers();

      expect(global.fetch).toHaveBeenCalledWith('/api/admin/drivers', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
      });
      expect(result).toEqual([mockDriver]);
    });

    it('throws with the server message when the fetch fails', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ message: 'Admin or operations_manager role required' }),
      });

      await expect(getDrivers()).rejects.toThrow('Admin or operations_manager role required');
    });
  });

  describe('linkDriverUser', () => {
    it('PATCHes the driver with the given user_id', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'd1', user_id: 'u2' }),
      });

      const result = await linkDriverUser('d1', 'u2');

      expect(global.fetch).toHaveBeenCalledWith('/api/admin/drivers/d1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: 'u2' }),
      });
      expect(result).toEqual({ id: 'd1', user_id: 'u2' });
    });

    it('PATCHes null to unlink', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'd1', user_id: null }),
      });

      await linkDriverUser('d1', null);

      expect(global.fetch).toHaveBeenCalledWith('/api/admin/drivers/d1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: null }),
      });
    });

    it('throws with the server message on a 409 duplicate link', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ code: 'DUPLICATE_USER_LINK', message: 'This user is already linked to another driver' }),
      });

      await expect(linkDriverUser('d1', 'u2')).rejects.toThrow('This user is already linked to another driver');
    });
  });
});
