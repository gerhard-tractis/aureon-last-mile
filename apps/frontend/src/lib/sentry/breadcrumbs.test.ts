import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Sentry from '@sentry/nextjs';
import {
  addActionBreadcrumb,
  addNavigationBreadcrumb,
  addAPIBreadcrumb,
  addStateBreadcrumb,
  addErrorBreadcrumb,
  addWarningBreadcrumb,
} from './breadcrumbs';

// Mock Sentry
vi.mock('@sentry/nextjs', () => ({
  addBreadcrumb: vi.fn(),
}));

describe('Breadcrumb Helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('addActionBreadcrumb', () => {
    it('should add action breadcrumb with message', () => {
      addActionBreadcrumb('Scanned barcode');

      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
        category: 'action',
        message: 'Scanned barcode',
        level: 'info',
        data: undefined,
      });
    });

    it('should add action breadcrumb with data', () => {
      addActionBreadcrumb('Created manifest', { manifestId: 'M-001' });

      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
        category: 'action',
        message: 'Created manifest',
        level: 'info',
        data: { manifestId: 'M-001' },
      });
    });
  });

  describe('addNavigationBreadcrumb', () => {
    it('should add navigation breadcrumb', () => {
      addNavigationBreadcrumb('/dashboard', { from: '/login' });

      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
        category: 'navigation',
        message: 'Navigated to /dashboard',
        level: 'info',
        data: { from: '/login' },
      });
    });
  });

  describe('addAPIBreadcrumb', () => {
    it('should add API breadcrumb', () => {
      addAPIBreadcrumb('POST /api/orders', { status: 201, duration: 150 });

      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
        category: 'api',
        message: 'POST /api/orders',
        level: 'info',
        data: { status: 201, duration: 150 },
      });
    });
  });

  describe('addStateBreadcrumb', () => {
    it('should add state change breadcrumb', () => {
      addStateBreadcrumb('User role changed', { from: 'driver', to: 'admin' });

      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
        category: 'state',
        message: 'User role changed',
        level: 'info',
        data: { from: 'driver', to: 'admin' },
      });
    });
  });

  describe('addErrorBreadcrumb', () => {
    it('should add error breadcrumb', () => {
      addErrorBreadcrumb('Validation failed', { field: 'email', error: 'Invalid format' });

      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
        category: 'error',
        message: 'Validation failed',
        level: 'error',
        data: { field: 'email', error: 'Invalid format' },
      });
    });
  });

  describe('addWarningBreadcrumb', () => {
    it('should add warning breadcrumb', () => {
      addWarningBreadcrumb('Approaching quota limit', { usage: '90%' });

      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
        category: 'warning',
        message: 'Approaching quota limit',
        level: 'warning',
        data: { usage: '90%' },
      });
    });
  });
});
