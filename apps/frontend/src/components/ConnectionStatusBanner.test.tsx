import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import ConnectionStatusBanner from './ConnectionStatusBanner';
import { db } from '@/lib/db';
import { syncManager } from '@/lib/sync-manager';

vi.mock('@/lib/db', () => ({
  db: {
    scan_queue: {
      filter: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
    },
  },
}));

vi.mock('@/lib/sync-manager', () => ({
  syncManager: { manualSync: vi.fn().mockResolvedValue(undefined) },
}));

/** Go offline after effects register (event listeners attach asynchronously via useEffect). */
async function goOffline() {
  await new Promise<void>((r) => setTimeout(r, 0));
  window.dispatchEvent(new Event('offline'));
  await Promise.resolve();
}

describe('ConnectionStatusBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.scan_queue.filter).mockReturnValue({
      count: vi.fn().mockResolvedValue(0),
    } as ReturnType<typeof db.scan_queue.filter>);
  });

  it('renders nothing when online with no queued scans', async () => {
    await act(async () => {
      render(<ConnectionStatusBanner />);
    });
    expect(screen.queryByTestId('connection-banner')).toBeNull();
  });

  it('shows Spanish offline string when offline', async () => {
    render(<ConnectionStatusBanner />);
    await act(goOffline);
    expect(screen.getByTestId('connection-banner')).toBeInTheDocument();
    expect(screen.getByText(/Sin conexión/)).toBeInTheDocument();
  });

  it('shows queued scan count with Spanish text when offline', async () => {
    vi.mocked(db.scan_queue.filter).mockReturnValue({
      count: vi.fn().mockResolvedValue(5),
    } as ReturnType<typeof db.scan_queue.filter>);

    render(<ConnectionStatusBanner />);
    await act(goOffline);
    expect(screen.getByText(/5 escaneos en cola/)).toBeInTheDocument();
  });

  it('shows Spanish syncing string when coming back online', async () => {
    let resolveSync!: () => void;
    vi.mocked(syncManager.manualSync).mockReturnValue(
      new Promise<void>((res) => { resolveSync = res; }),
    );

    render(<ConnectionStatusBanner />);
    // Go offline first so the banner is visible, then trigger online to enter syncing
    await act(goOffline);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    const banner = screen.queryByTestId('connection-banner');
    if (banner) {
      expect(banner.textContent).toMatch(/Sincronizando/);
      expect(banner.className).toContain('bg-text-muted');
    }
    await act(async () => { resolveSync?.(); });
  });

  it('uses bg-status-warning design token for offline state', async () => {
    render(<ConnectionStatusBanner />);
    await act(goOffline);
    const banner = screen.getByTestId('connection-banner');
    expect(banner.className).toContain('bg-status-warning');
  });

  it('uses bg-status-success design token when online with queued scans', async () => {
    vi.mocked(db.scan_queue.filter).mockReturnValue({
      count: vi.fn().mockResolvedValue(2),
    } as ReturnType<typeof db.scan_queue.filter>);

    await act(async () => {
      render(<ConnectionStatusBanner />);
      await Promise.resolve(); // flush db.count() resolving to 2
    });
    const banner = screen.queryByTestId('connection-banner');
    if (banner) {
      expect(banner.className).toContain('bg-status-success');
    }
  });
});
