import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouteBlockList } from './RouteBlockList';
import type { RouteBlocksResult } from '@/lib/dispatch/types';

/**
 * spec-72 phase 3 — the block list UI. Mocks `useRouteBlocks` directly
 * (its own read/derive logic is covered by useRouteBlocks.test.ts) so these
 * tests are about rendering order, the move buttons, and the orphan /
 * "sin comuna" surfacing — not the Supabase query shape.
 */
let mockResult: {
  data: RouteBlocksResult | undefined;
  isLoading: boolean;
  isError?: boolean;
  refetch: () => void;
};
const refetchMock = vi.fn();
vi.mock('@/hooks/dispatch/useRouteBlocks', () => ({
  useRouteBlocks: () => mockResult,
}));

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  Wrapper.displayName = 'TestWrapper';
  return Wrapper;
}

beforeEach(() => {
  vi.resetAllMocks();
  global.fetch = vi.fn();
  mockResult = { data: { blocks: [], unblocked: [] }, isLoading: false, refetch: refetchMock };
});

describe('RouteBlockList', () => {
  it('renders nothing while loading', () => {
    mockResult = { data: undefined, isLoading: true, refetch: refetchMock };
    const { container } = render(<RouteBlockList routeId="r1" operatorId="op-1" routeStatus="planned" />, { wrapper: wrapper() });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when there are no blocks and nothing unblocked', () => {
    const { container } = render(<RouteBlockList routeId="r1" operatorId="op-1" routeStatus="planned" />, { wrapper: wrapper() });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders blocks in sequence_index order with comuna name and counts', () => {
    mockResult = {
      data: {
        blocks: [
          { id: 'b1', comunaId: 'c1', comunaName: 'Uno', sequenceIndex: 1, sequenceSource: 'default', orderCount: 2, packageCount: 3, actualRank: null, outOfSequence: false },
          { id: 'b2', comunaId: 'c2', comunaName: 'Dos', sequenceIndex: 2, sequenceSource: 'manual', orderCount: 1, packageCount: 1, actualRank: null, outOfSequence: false },
        ],
        unblocked: [],
      },
      isLoading: false,
      refetch: refetchMock,
    };
    render(<RouteBlockList routeId="r1" operatorId="op-1" routeStatus="planned" />, { wrapper: wrapper() });

    const items = screen.getAllByRole('listitem').filter((li) => li.textContent?.includes('orden'));
    expect(items[0]).toHaveTextContent('Uno');
    expect(items[0]).toHaveTextContent(/2 .rdenes · 3 bultos/i);
    expect(items[1]).toHaveTextContent('Dos');
    expect(items[1]).toHaveTextContent('1 orden · 1 bulto');
    expect(items[1]).toHaveTextContent('(manual)');
  });

  // spec-72 phase 5 — planned-vs-actual badge, read-only presentation.
  describe('phase 5 — planned-vs-actual badge', () => {
    it('renders no badge when actualRank is null (no arrival data yet)', () => {
      mockResult = {
        data: {
          blocks: [
            { id: 'b1', comunaId: 'c1', comunaName: 'Uno', sequenceIndex: 1, sequenceSource: 'default', orderCount: 1, packageCount: 1, actualRank: null, outOfSequence: false },
          ],
          unblocked: [],
        },
        isLoading: false,
        refetch: refetchMock,
      };
      render(<RouteBlockList routeId="r1" operatorId="op-1" routeStatus="planned" />, { wrapper: wrapper() });

      expect(screen.queryByText(/en orden/)).not.toBeInTheDocument();
      expect(screen.queryByText(/orden real/)).not.toBeInTheDocument();
    });

    it('renders an in-sequence badge when actualRank matches the planned position', () => {
      mockResult = {
        data: {
          blocks: [
            { id: 'b1', comunaId: 'c1', comunaName: 'Uno', sequenceIndex: 1, sequenceSource: 'default', orderCount: 1, packageCount: 1, actualRank: 1, outOfSequence: false },
          ],
          unblocked: [],
        },
        isLoading: false,
        refetch: refetchMock,
      };
      render(<RouteBlockList routeId="r1" operatorId="op-1" routeStatus="planned" />, { wrapper: wrapper() });

      expect(screen.getByText('✓ en orden')).toBeInTheDocument();
    });

    it('renders an out-of-sequence warning badge with the actual rank when it diverges from the plan', () => {
      mockResult = {
        data: {
          blocks: [
            { id: 'b1', comunaId: 'c1', comunaName: 'Uno', sequenceIndex: 1, sequenceSource: 'default', orderCount: 1, packageCount: 1, actualRank: 2, outOfSequence: true },
          ],
          unblocked: [],
        },
        isLoading: false,
        refetch: refetchMock,
      };
      render(<RouteBlockList routeId="r1" operatorId="op-1" routeStatus="planned" />, { wrapper: wrapper() });

      expect(screen.getByText('⚠ orden real: 2')).toBeInTheDocument();
      expect(screen.queryByText('✓ en orden')).not.toBeInTheDocument();
    });

    it('never shows the badge for an orphan/unblocked row — it has no block to attach to', () => {
      mockResult = {
        data: {
          blocks: [],
          unblocked: [{ orderId: 'o1', orderNumber: 'ORD-1', comunaName: 'Uno', reason: 'orphan' }],
        },
        isLoading: false,
        refetch: refetchMock,
      };
      render(<RouteBlockList routeId="r1" operatorId="op-1" routeStatus="planned" />, { wrapper: wrapper() });

      expect(screen.queryByText(/en orden/)).not.toBeInTheDocument();
      expect(screen.queryByText(/orden real/)).not.toBeInTheDocument();
    });
  });

  it('disables move-up on the first block and move-down on the last block', () => {
    mockResult = {
      data: {
        blocks: [
          { id: 'b1', comunaId: 'c1', comunaName: 'Uno', sequenceIndex: 1, sequenceSource: 'default', orderCount: 1, packageCount: 1, actualRank: null, outOfSequence: false },
          { id: 'b2', comunaId: 'c2', comunaName: 'Dos', sequenceIndex: 2, sequenceSource: 'default', orderCount: 1, packageCount: 1, actualRank: null, outOfSequence: false },
        ],
        unblocked: [],
      },
      isLoading: false,
      refetch: refetchMock,
    };
    render(<RouteBlockList routeId="r1" operatorId="op-1" routeStatus="planned" />, { wrapper: wrapper() });

    expect(screen.getByLabelText('Mover Uno hacia arriba')).toBeDisabled();
    expect(screen.getByLabelText('Mover Uno hacia abajo')).not.toBeDisabled();
    expect(screen.getByLabelText('Mover Dos hacia arriba')).not.toBeDisabled();
    expect(screen.getByLabelText('Mover Dos hacia abajo')).toBeDisabled();
  });

  it('clicking move-down PATCHes the block API with direction=down and refetches on success', async () => {
    mockResult = {
      data: {
        blocks: [
          { id: 'b1', comunaId: 'c1', comunaName: 'Uno', sequenceIndex: 1, sequenceSource: 'default', orderCount: 1, packageCount: 1, actualRank: null, outOfSequence: false },
          { id: 'b2', comunaId: 'c2', comunaName: 'Dos', sequenceIndex: 2, sequenceSource: 'default', orderCount: 1, packageCount: 1, actualRank: null, outOfSequence: false },
        ],
        unblocked: [],
      },
      isLoading: false,
      refetch: refetchMock,
    };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    render(<RouteBlockList routeId="r1" operatorId="op-1" routeStatus="planned" />, { wrapper: wrapper() });
    await userEvent.click(screen.getByLabelText('Mover Uno hacia abajo'));

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/dispatch/routes/r1/blocks/b1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ direction: 'down' }),
      }),
    );
    await waitFor(() => expect(refetchMock).toHaveBeenCalled());
  });

  it('shows the API error message and does not refetch when the move fails', async () => {
    mockResult = {
      data: {
        blocks: [
          { id: 'b1', comunaId: 'c1', comunaName: 'Uno', sequenceIndex: 1, sequenceSource: 'default', orderCount: 1, packageCount: 1, actualRank: null, outOfSequence: false },
          { id: 'b2', comunaId: 'c2', comunaName: 'Dos', sequenceIndex: 2, sequenceSource: 'default', orderCount: 1, packageCount: 1, actualRank: null, outOfSequence: false },
        ],
        unblocked: [],
      },
      isLoading: false,
      refetch: refetchMock,
    };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'No se pudo reordenar' }),
    });

    render(<RouteBlockList routeId="r1" operatorId="op-1" routeStatus="planned" />, { wrapper: wrapper() });
    await userEvent.click(screen.getByLabelText('Mover Uno hacia abajo'));

    await waitFor(() => expect(screen.getByText('⚠ No se pudo reordenar')).toBeInTheDocument());
    expect(refetchMock).not.toHaveBeenCalled();
  });

  it('surfaces an orphan order distinctly from "sin comuna"', () => {
    mockResult = {
      data: {
        blocks: [
          { id: 'b1', comunaId: 'c1', comunaName: 'Uno', sequenceIndex: 1, sequenceSource: 'default', orderCount: 1, packageCount: 1, actualRank: null, outOfSequence: false },
        ],
        unblocked: [
          { orderId: 'o2', orderNumber: 'ORD-2', comunaName: 'Dos', reason: 'orphan' },
          { orderId: 'o3', orderNumber: 'ORD-3', comunaName: null, reason: 'noComuna' },
        ],
      },
      isLoading: false,
      refetch: refetchMock,
    };
    render(<RouteBlockList routeId="r1" operatorId="op-1" routeStatus="planned" />, { wrapper: wrapper() });

    expect(screen.getByText('Sin secuencia asignada')).toBeInTheDocument();
    expect(screen.getByText(/ORD-2/)).toHaveTextContent('sin bloque (Dos)');
    expect(screen.getByText(/ORD-3/)).toHaveTextContent('sin comuna');
  });

  it('renders an empty-draft route (no blocks at all) by showing every order as unblocked, not an empty screen', () => {
    mockResult = {
      data: {
        blocks: [],
        unblocked: [
          { orderId: 'o1', orderNumber: 'ORD-1', comunaName: 'Uno', reason: 'orphan' },
          { orderId: 'o2', orderNumber: 'ORD-2', comunaName: 'Dos', reason: 'orphan' },
        ],
      },
      isLoading: false,
      refetch: refetchMock,
    };
    render(<RouteBlockList routeId="r1" operatorId="op-1" routeStatus="planned" />, { wrapper: wrapper() });

    expect(screen.getByText('Sin secuencia asignada')).toBeInTheDocument();
    expect(screen.getByText(/ORD-1/)).toBeInTheDocument();
    expect(screen.getByText(/ORD-2/)).toBeInTheDocument();
  });

  // spec-72 phase 3 review item 2 — the writer half: the orphan section
  // must offer a way to actually sequence an orphan, not just display it.
  describe('review item 2 — "Agregar a la secuencia"', () => {
    function orphanResult() {
      return {
        data: {
          blocks: [],
          unblocked: [
            { orderId: 'o1', orderNumber: 'ORD-1', comunaName: 'Uno', reason: 'orphan' as const },
            { orderId: 'o2', orderNumber: 'ORD-2', comunaName: null, reason: 'noComuna' as const },
          ],
        },
        isLoading: false,
        refetch: refetchMock,
      };
    }

    it('POSTs the blocks endpoint and refetches on success', async () => {
      mockResult = orphanResult();
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true }),
      });

      render(<RouteBlockList routeId="r1" operatorId="op-1" routeStatus="planned" />, { wrapper: wrapper() });
      await userEvent.click(screen.getByText('Agregar a la secuencia'));

      expect(global.fetch).toHaveBeenCalledWith('/api/dispatch/routes/r1/blocks', { method: 'POST' });
      await waitFor(() => expect(refetchMock).toHaveBeenCalled());
    });

    it('shows the API error message and does not refetch when seeding fails', async () => {
      mockResult = orphanResult();
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        json: async () => ({ message: 'No se pudo agregar' }),
      });

      render(<RouteBlockList routeId="r1" operatorId="op-1" routeStatus="planned" />, { wrapper: wrapper() });
      await userEvent.click(screen.getByText('Agregar a la secuencia'));

      await waitFor(() => expect(screen.getByText('⚠ No se pudo agregar')).toBeInTheDocument());
      expect(refetchMock).not.toHaveBeenCalled();
    });

    it('does not render the button when there are no orphans (only "sin comuna" rows)', () => {
      mockResult = {
        data: {
          blocks: [],
          unblocked: [{ orderId: 'o2', orderNumber: 'ORD-2', comunaName: null, reason: 'noComuna' }],
        },
        isLoading: false,
        refetch: refetchMock,
      };
      render(<RouteBlockList routeId="r1" operatorId="op-1" routeStatus="planned" />, { wrapper: wrapper() });

      expect(screen.queryByText('Agregar a la secuencia')).not.toBeInTheDocument();
    });
  });

  // spec-72 phase 3 review item 1 — the same editable window gates both the
  // reorder buttons and the "Agregar a la secuencia" button.
  describe('review item 1 — editable-window gating', () => {
    const twoBlocks = {
      blocks: [
        { id: 'b1', comunaId: 'c1', comunaName: 'Uno', sequenceIndex: 1, sequenceSource: 'default' as const, orderCount: 1, packageCount: 1, actualRank: null, outOfSequence: false },
        { id: 'b2', comunaId: 'c2', comunaName: 'Dos', sequenceIndex: 2, sequenceSource: 'default' as const, orderCount: 1, packageCount: 1, actualRank: null, outOfSequence: false },
      ],
      unblocked: [{ orderId: 'o3', orderNumber: 'ORD-3', comunaName: 'Tres', reason: 'orphan' as const }],
    };

    it.each(['loaded', 'dispatched', 'in_transit', 'completed'] as const)(
      'disables move and seed buttons once the route is %s',
      (status) => {
        mockResult = { data: twoBlocks, isLoading: false, refetch: refetchMock };
        render(<RouteBlockList routeId="r1" operatorId="op-1" routeStatus={status} />, { wrapper: wrapper() });

        expect(screen.getByLabelText('Mover Dos hacia arriba')).toBeDisabled();
        expect(screen.getByText('Agregar a la secuencia')).toBeDisabled();
      },
    );

    it('disables move and seed buttons when routeStatus is not yet known (undefined)', () => {
      mockResult = { data: twoBlocks, isLoading: false, refetch: refetchMock };
      render(<RouteBlockList routeId="r1" operatorId="op-1" routeStatus={undefined} />, { wrapper: wrapper() });

      expect(screen.getByLabelText('Mover Dos hacia arriba')).toBeDisabled();
      expect(screen.getByText('Agregar a la secuencia')).toBeDisabled();
    });

    it.each(['draft', 'planned', 'loading'] as const)(
      'leaves move and seed buttons enabled while the route is %s',
      (status) => {
        mockResult = { data: twoBlocks, isLoading: false, refetch: refetchMock };
        render(<RouteBlockList routeId="r1" operatorId="op-1" routeStatus={status} />, { wrapper: wrapper() });

        expect(screen.getByLabelText('Mover Dos hacia arriba')).not.toBeDisabled();
        expect(screen.getByText('Agregar a la secuencia')).not.toBeDisabled();
      },
    );
  });

  // spec-72 phase 3 review item 4 — the orphan list must not be able to
  // push RouteBuilder's package list off-screen.
  it('caps the orphan list height and scrolls internally instead of growing unbounded', () => {
    mockResult = {
      data: {
        blocks: [],
        unblocked: Array.from({ length: 12 }, (_, i) => ({
          orderId: `o${i}`,
          orderNumber: `ORD-${i}`,
          comunaName: 'Uno',
          reason: 'orphan' as const,
        })),
      },
      isLoading: false,
      refetch: refetchMock,
    };
    render(<RouteBlockList routeId="r1" operatorId="op-1" routeStatus="planned" />, { wrapper: wrapper() });

    const list = screen.getByText(/ORD-0/).closest('ul');
    expect(list).toHaveClass('max-h-32');
    expect(list).toHaveClass('overflow-y-auto');
  });

  // Phase-4 review item 4 (HIGH): a failed read used to fall through to the
  // same "nothing to show" branch as a legitimately empty route, hiding the
  // failure entirely.
  describe('when the blocks read fails', () => {
    it('renders an explicit error, not nothing', () => {
      mockResult = { data: undefined, isLoading: false, isError: true, refetch: refetchMock };
      const { container } = render(
        <RouteBlockList routeId="r1" operatorId="op-1" routeStatus="planned" />,
        { wrapper: wrapper() },
      );
      expect(container).not.toBeEmptyDOMElement();
      expect(screen.getByText(/No se pudo cargar la secuencia/)).toBeInTheDocument();
    });

    it('offers a retry that calls refetch', async () => {
      mockResult = { data: undefined, isLoading: false, isError: true, refetch: refetchMock };
      render(<RouteBlockList routeId="r1" operatorId="op-1" routeStatus="planned" />, { wrapper: wrapper() });
      await userEvent.click(screen.getByText('Reintentar'));
      expect(refetchMock).toHaveBeenCalled();
    });

    it('does not render blocks or the orphan list underneath the error', () => {
      mockResult = { data: undefined, isLoading: false, isError: true, refetch: refetchMock };
      render(<RouteBlockList routeId="r1" operatorId="op-1" routeStatus="planned" />, { wrapper: wrapper() });
      expect(screen.queryByText('Secuencia de entrega por comuna')).not.toBeInTheDocument();
    });
  });
});
