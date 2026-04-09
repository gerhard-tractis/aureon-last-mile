import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
  useRouter: vi.fn(),
}));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: vi.fn() }));

import { useSearchParams, useRouter } from 'next/navigation';
import { useIsMobile } from '@/hooks/useIsMobile';
import { DrillSheet } from './DrillSheet';

const mockReplace = vi.fn();

function setupMocks({
  drill,
  isMobile = false,
}: {
  drill?: string;
  isMobile?: boolean;
}) {
  const params = new URLSearchParams();
  if (drill) params.set('drill', drill);
  vi.mocked(useSearchParams).mockReturnValue(params as ReturnType<typeof useSearchParams>);
  vi.mocked(useRouter).mockReturnValue({ replace: mockReplace } as ReturnType<typeof useRouter>);
  vi.mocked(useIsMobile).mockReturnValue(isMobile);
}

describe('DrillSheet', () => {
  beforeEach(() => {
    mockReplace.mockClear();
  });

  it('does not render sheet content when ?drill is absent', () => {
    setupMocks({ drill: undefined });
    render(<DrillSheet />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders sheet open with title "Razones de retraso" when ?drill=late_reasons', async () => {
    setupMocks({ drill: 'late_reasons' });
    render(<DrillSheet />);
    expect(await screen.findByText('Razones de retraso')).toBeInTheDocument();
  });

  it('renders sheet open with title "OTIF por región" when ?drill=region', async () => {
    setupMocks({ drill: 'region' });
    render(<DrillSheet />);
    expect(await screen.findByText('OTIF por región')).toBeInTheDocument();
  });

  it('renders sheet open with title "OTIF por cliente" when ?drill=customer', async () => {
    setupMocks({ drill: 'customer' });
    render(<DrillSheet />);
    expect(await screen.findByText('OTIF por cliente')).toBeInTheDocument();
  });

  it('renders sheet open with title "FADR — Motivos de no entrega" when ?drill=fadr', async () => {
    setupMocks({ drill: 'fadr' });
    render(<DrillSheet />);
    expect(await screen.findByText('FADR — Motivos de no entrega')).toBeInTheDocument();
  });

  it('SheetContent has side="right" on desktop (useIsMobile=false)', async () => {
    setupMocks({ drill: 'region', isMobile: false });
    render(<DrillSheet />);
    // The SheetContent applies class based on side variant — right side has slide-out-to-right
    await screen.findByText('OTIF por región');
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toMatch(/slide-out-to-right|inset-y-0 right-0/);
  });

  it('SheetContent has side="bottom" on mobile (useIsMobile=true)', async () => {
    setupMocks({ drill: 'region', isMobile: true });
    render(<DrillSheet />);
    await screen.findByText('OTIF por región');
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toMatch(/slide-out-to-bottom|inset-x-0 bottom-0/);
  });

  it('closing the sheet calls router.replace removing the drill param', async () => {
    setupMocks({ drill: 'region' });
    const { container } = render(<DrillSheet />);
    await screen.findByText('OTIF por región');
    // Find the close button rendered by SheetContent (X icon with sr-only "Close")
    const closeBtn = container.querySelector('[data-testid="drill-sheet-close"], button[aria-label="Close"], .sr-only')?.closest('button')
      ?? screen.getByRole('button', { name: /close/i });
    closeBtn.click();
    expect(mockReplace).toHaveBeenCalledWith(
      expect.stringMatching(/^\?/),
      { scroll: false },
    );
    // The replaced URL must not contain the drill param
    const calledUrl: string = mockReplace.mock.calls[0][0];
    expect(calledUrl).not.toContain('drill=');
  });
});
