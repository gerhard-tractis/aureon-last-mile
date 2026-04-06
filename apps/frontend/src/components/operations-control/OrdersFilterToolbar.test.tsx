/**
 * Tests for OrdersFilterToolbar component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OrdersFilterToolbar } from './OrdersFilterToolbar';

const mockSetSearch = vi.fn();
const mockSetDatePreset = vi.fn();
const mockSetStatusFilter = vi.fn();
const mockSetStageFilter = vi.fn();
const mockClearAllFilters = vi.fn();

const defaultStoreState = {
  search: '',
  datePreset: 'today' as const,
  statusFilter: 'all' as const,
  stageFilter: null,
  setSearch: mockSetSearch,
  setDatePreset: mockSetDatePreset,
  setStatusFilter: mockSetStatusFilter,
  setStageFilter: mockSetStageFilter,
  clearAllFilters: mockClearAllFilters,
};

vi.mock('@/lib/stores/useOpsControlFilterStore', () => ({
  useOpsControlFilterStore: vi.fn(() => defaultStoreState),
}));

import { useOpsControlFilterStore } from '@/lib/stores/useOpsControlFilterStore';

describe('OrdersFilterToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useOpsControlFilterStore).mockReturnValue(defaultStoreState);
  });

  describe('Rendering', () => {
    it('renders search input', () => {
      render(<OrdersFilterToolbar />);
      const input = screen.getByPlaceholderText('Buscar orden, cliente...');
      expect(input).toBeTruthy();
    });

    it('renders date select', () => {
      render(<OrdersFilterToolbar />);
      const dateSelect = screen.getByTestId('date-select');
      expect(dateSelect).toBeTruthy();
    });

    it('renders status select', () => {
      render(<OrdersFilterToolbar />);
      const statusSelect = screen.getByTestId('status-select');
      expect(statusSelect).toBeTruthy();
    });

    it('renders date options in Spanish', () => {
      render(<OrdersFilterToolbar />);
      const dateSelect = screen.getByTestId('date-select');
      expect(dateSelect).toHaveTextContent('Hoy');
      expect(dateSelect).toHaveTextContent('Mañana');
      expect(dateSelect).toHaveTextContent('Próximos 7 días');
      expect(dateSelect).toHaveTextContent('Rango personalizado');
    });

    it('renders status options in Spanish', () => {
      render(<OrdersFilterToolbar />);
      const statusSelect = screen.getByTestId('status-select');
      expect(statusSelect).toHaveTextContent('Todos');
      expect(statusSelect).toHaveTextContent('Urgentes');
      expect(statusSelect).toHaveTextContent('Alertas');
      expect(statusSelect).toHaveTextContent('OK');
      expect(statusSelect).toHaveTextContent('Atrasados');
    });
  });

  describe('Search input', () => {
    it('calls setSearch when search input changes', () => {
      render(<OrdersFilterToolbar />);
      const input = screen.getByPlaceholderText('Buscar orden, cliente...');
      fireEvent.change(input, { target: { value: 'pedido123' } });
      expect(mockSetSearch).toHaveBeenCalledWith('pedido123');
    });

    it('shows current search value from store', () => {
      vi.mocked(useOpsControlFilterStore).mockReturnValue({
        ...defaultStoreState,
        search: 'cliente abc',
      });
      render(<OrdersFilterToolbar />);
      const input = screen.getByPlaceholderText('Buscar orden, cliente...');
      expect((input as HTMLInputElement).value).toBe('cliente abc');
    });
  });

  describe('Date select', () => {
    it('calls setDatePreset when date select changes', () => {
      render(<OrdersFilterToolbar />);
      const dateSelect = screen.getByTestId('date-select');
      fireEvent.change(dateSelect, { target: { value: 'tomorrow' } });
      expect(mockSetDatePreset).toHaveBeenCalledWith('tomorrow');
    });

    it('shows current datePreset value from store', () => {
      vi.mocked(useOpsControlFilterStore).mockReturnValue({
        ...defaultStoreState,
        datePreset: 'next7',
      });
      render(<OrdersFilterToolbar />);
      const dateSelect = screen.getByTestId('date-select') as HTMLSelectElement;
      expect(dateSelect.value).toBe('next7');
    });
  });

  describe('Status select', () => {
    it('calls setStatusFilter when status select changes', () => {
      render(<OrdersFilterToolbar />);
      const statusSelect = screen.getByTestId('status-select');
      fireEvent.change(statusSelect, { target: { value: 'urgent' } });
      expect(mockSetStatusFilter).toHaveBeenCalledWith('urgent');
    });

    it('shows current statusFilter value from store', () => {
      vi.mocked(useOpsControlFilterStore).mockReturnValue({
        ...defaultStoreState,
        statusFilter: 'late',
      });
      render(<OrdersFilterToolbar />);
      const statusSelect = screen.getByTestId('status-select') as HTMLSelectElement;
      expect(statusSelect.value).toBe('late');
    });
  });

  describe('Stage filter badge', () => {
    it('does not show stage badge when stageFilter is null', () => {
      render(<OrdersFilterToolbar />);
      expect(screen.queryByTestId('stage-filter-badge')).toBeNull();
    });

    it('shows stage badge when stageFilter is set', () => {
      vi.mocked(useOpsControlFilterStore).mockReturnValue({
        ...defaultStoreState,
        stageFilter: 'en_bodega',
      });
      render(<OrdersFilterToolbar />);
      const badge = screen.getByTestId('stage-filter-badge');
      expect(badge).toBeTruthy();
      expect(badge).toHaveTextContent('En Bodega');
    });

    it('shows correct Spanish label for stageFilter', () => {
      vi.mocked(useOpsControlFilterStore).mockReturnValue({
        ...defaultStoreState,
        stageFilter: 'en_ruta',
      });
      render(<OrdersFilterToolbar />);
      const badge = screen.getByTestId('stage-filter-badge');
      expect(badge).toHaveTextContent('En Ruta');
    });

    it('clicking × on stage badge calls setStageFilter(null)', () => {
      vi.mocked(useOpsControlFilterStore).mockReturnValue({
        ...defaultStoreState,
        stageFilter: 'asignado',
      });
      render(<OrdersFilterToolbar />);
      const clearBtn = screen.getByTestId('stage-filter-clear');
      fireEvent.click(clearBtn);
      expect(mockSetStageFilter).toHaveBeenCalledWith(null);
    });
  });

  describe('Limpiar filtros button', () => {
    it('is hidden when all filters are at defaults', () => {
      render(<OrdersFilterToolbar />);
      expect(screen.queryByText('Limpiar filtros')).toBeNull();
    });

    it('is visible when search is non-empty', () => {
      vi.mocked(useOpsControlFilterStore).mockReturnValue({
        ...defaultStoreState,
        search: 'algo',
      });
      render(<OrdersFilterToolbar />);
      expect(screen.getByText('Limpiar filtros')).toBeTruthy();
    });

    it('is visible when datePreset is not today', () => {
      vi.mocked(useOpsControlFilterStore).mockReturnValue({
        ...defaultStoreState,
        datePreset: 'tomorrow',
      });
      render(<OrdersFilterToolbar />);
      expect(screen.getByText('Limpiar filtros')).toBeTruthy();
    });

    it('is visible when statusFilter is not all', () => {
      vi.mocked(useOpsControlFilterStore).mockReturnValue({
        ...defaultStoreState,
        statusFilter: 'alert',
      });
      render(<OrdersFilterToolbar />);
      expect(screen.getByText('Limpiar filtros')).toBeTruthy();
    });

    it('is visible when stageFilter is set', () => {
      vi.mocked(useOpsControlFilterStore).mockReturnValue({
        ...defaultStoreState,
        stageFilter: 'listo',
      });
      render(<OrdersFilterToolbar />);
      expect(screen.getByText('Limpiar filtros')).toBeTruthy();
    });

    it('clicking Limpiar filtros calls clearAllFilters', () => {
      vi.mocked(useOpsControlFilterStore).mockReturnValue({
        ...defaultStoreState,
        search: 'algo',
      });
      render(<OrdersFilterToolbar />);
      const btn = screen.getByText('Limpiar filtros');
      fireEvent.click(btn);
      expect(mockClearAllFilters).toHaveBeenCalledOnce();
    });
  });
});
