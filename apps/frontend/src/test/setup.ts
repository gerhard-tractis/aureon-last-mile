/**
 * Global Test Setup
 * Runs before all tests
 */

import '@testing-library/jest-dom';
import 'fake-indexeddb/auto';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Auto-cleanup after each test
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Mock window.matchMedia (for responsive components)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock navigator.serviceWorker
Object.defineProperty(navigator, 'serviceWorker', {
  writable: true,
  value: {
    ready: Promise.resolve({
      sync: {
        register: vi.fn().mockResolvedValue(undefined),
      },
    }),
    register: vi.fn().mockResolvedValue({
      sync: {
        register: vi.fn().mockResolvedValue(undefined),
      },
    }),
  },
});

// Mock navigator.onLine
Object.defineProperty(navigator, 'onLine', {
  writable: true,
  value: true,
});

// Mock global fetch
global.fetch = vi.fn();

// Mock window.location
/* eslint-disable @typescript-eslint/no-explicit-any */
delete (window as any).location;
window.location = {
  reload: vi.fn(),
  href: '',
  origin: 'http://localhost:3000',
} as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

// Mock window.history
window.history.back = vi.fn();

// Polyfill ResizeObserver (used by cmdk / shadcn Command component)
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Polyfill scrollIntoView (used by cmdk for keyboard navigation)
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

// Polyfill Blob/File.prototype.arrayBuffer — jsdom does not implement it
// Uses FileReader which jsdom does implement.
if (typeof Blob !== 'undefined' && !Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function () {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}
