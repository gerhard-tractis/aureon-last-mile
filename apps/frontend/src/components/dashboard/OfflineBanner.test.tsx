import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import OfflineBanner from './OfflineBanner';

// jsdom defines navigator.onLine as a non-configurable own property.
// We override it by redefining on the window object with a configurable descriptor.
function setOnLine(value: boolean) {
  Object.defineProperty(window, 'navigator', {
    value: Object.create(window.navigator, {
      onLine: { get: () => value, configurable: true, enumerable: true },
    }),
    configurable: true,
    writable: true,
  });
}

describe('OfflineBanner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // Reset navigator to online
    setOnLine(true);
  });

  it('renders nothing when online', () => {
    setOnLine(true);
    render(<OfflineBanner />);
    expect(screen.queryByText(/Sin conexión/i)).toBeNull();
  });

  it('shows offline banner when offline', () => {
    setOnLine(false);
    render(<OfflineBanner />);
    expect(screen.getByText(/Sin conexión/i)).toBeDefined();
  });

  it('shows banner when offline event fires', () => {
    setOnLine(true);
    render(<OfflineBanner />);
    expect(screen.queryByText(/Sin conexión/i)).toBeNull();

    act(() => {
      setOnLine(false);
      window.dispatchEvent(new Event('offline'));
    });

    expect(screen.getByText(/Sin conexión/i)).toBeDefined();
  });

  it('hides banner when online event fires after being offline', () => {
    setOnLine(false);
    render(<OfflineBanner />);
    expect(screen.getByText(/Sin conexión/i)).toBeDefined();

    act(() => {
      setOnLine(true);
      window.dispatchEvent(new Event('online'));
    });

    expect(screen.queryByText(/Sin conexión/i)).toBeNull();
  });
});
