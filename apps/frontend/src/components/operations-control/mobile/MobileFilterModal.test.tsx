/**
 * Tests for MobileFilterModal component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileFilterModal } from './MobileFilterModal';

const mockSetStatusFilter = vi.fn();
const mockSetDatePreset = vi.fn();
const mockSetStageFilter = vi.fn();
const mockClearAllFilters = vi.fn();

const defaultStoreState = {
  search: '',
  datePreset: 'today' as const,
  dateRange: null,
  statusFilter: 'all' as const,
  stageFilter: null,
  setSearch: vi.fn(),
  setDatePreset: mockSetDatePreset,
  setDateRange: vi.fn(),
  setStatusFilter: mockSetStatusFilter,
  setStageFilter: mockSetStageFilter,
  clearAllFilters: mockClearAllFilters,
};

vi.mock('@/lib/stores/useOpsControlFilterStore', () => ({
  useOpsControlFilterStore: vi.fn(() => defaultStoreState),
}));

import { useOpsControlFilterStore } from '@/lib/stores/useOpsControlFilterStore';

describe('MobileFilterModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useOpsControlFilterStore).mockReturnValue(defaultStoreState);
  });

  describe('Visibility', () => {
    it('does not render when open=false', () => {
      render(<MobileFilterModal open={false} onClose={vi.fn()} />);
      expect(screen.queryByText('Filtros')).toBeNull();
    });

    it('renders when open=true', () => {
      render(<MobileFilterModal open={true} onClose={vi.fn()} />);
      expect(screen.getByText('Filtros')).toBeTruthy();
    });
  });

  describe('Sections when open', () => {
    it('renders Estado section', () => {
      render(<MobileFilterModal open={true} onClose={vi.fn()} />);
      expect(screen.getByText('Estado')).toBeTruthy();
    });

    it('renders Fecha section', () => {
      render(<MobileFilterModal open={true} onClose={vi.fn()} />);
      expect(screen.getByText('Fecha')).toBeTruthy();
    });

    it('renders Etapa section', () => {
      render(<MobileFilterModal open={true} onClose={vi.fn()} />);
      expect(screen.getByText('Etapa')).toBeTruthy();
    });

    it('renders status pills: Todos, Urgentes, Alertas, OK, Atrasados', () => {
      render(<MobileFilterModal open={true} onClose={vi.fn()} />);
      expect(screen.getByText('Todos')).toBeTruthy();
      expect(screen.getByText('Urgentes')).toBeTruthy();
      expect(screen.getByText('Alertas')).toBeTruthy();
      expect(screen.getByText('OK')).toBeTruthy();
      expect(screen.getByText('Atrasados')).toBeTruthy();
    });

    it('renders date pills: Hoy, Mañana, 7 días', () => {
      render(<MobileFilterModal open={true} onClose={vi.fn()} />);
      expect(screen.getByText('Hoy')).toBeTruthy();
      expect(screen.getByText('Mañana')).toBeTruthy();
      expect(screen.getByText('7 días')).toBeTruthy();
    });

    it('renders all 8 pipeline stage pills', () => {
      render(<MobileFilterModal open={true} onClose={vi.fn()} />);
      expect(screen.getByText('Ingresado')).toBeTruthy();
      expect(screen.getByText('Verificado')).toBeTruthy();
      expect(screen.getByText('En Bodega')).toBeTruthy();
      expect(screen.getByText('Asignado')).toBeTruthy();
      expect(screen.getByText('En Carga')).toBeTruthy();
      expect(screen.getByText('Listo')).toBeTruthy();
      expect(screen.getByText('En Ruta')).toBeTruthy();
      expect(screen.getByText('Entregado')).toBeTruthy();
    });
  });

  describe('Filter interactions', () => {
    it('clicking a status pill calls setStatusFilter', () => {
      render(<MobileFilterModal open={true} onClose={vi.fn()} />);
      fireEvent.click(screen.getByText('Urgentes'));
      expect(mockSetStatusFilter).toHaveBeenCalledWith('urgent');
    });

    it('clicking Todos status pill calls setStatusFilter with "all"', () => {
      render(<MobileFilterModal open={true} onClose={vi.fn()} />);
      fireEvent.click(screen.getByText('Todos'));
      expect(mockSetStatusFilter).toHaveBeenCalledWith('all');
    });

    it('clicking Alertas status pill calls setStatusFilter with "alert"', () => {
      render(<MobileFilterModal open={true} onClose={vi.fn()} />);
      fireEvent.click(screen.getByText('Alertas'));
      expect(mockSetStatusFilter).toHaveBeenCalledWith('alert');
    });

    it('clicking Atrasados status pill calls setStatusFilter with "late"', () => {
      render(<MobileFilterModal open={true} onClose={vi.fn()} />);
      fireEvent.click(screen.getByText('Atrasados'));
      expect(mockSetStatusFilter).toHaveBeenCalledWith('late');
    });

    it('clicking a date pill calls setDatePreset', () => {
      render(<MobileFilterModal open={true} onClose={vi.fn()} />);
      fireEvent.click(screen.getByText('Mañana'));
      expect(mockSetDatePreset).toHaveBeenCalledWith('tomorrow');
    });

    it('clicking Hoy date pill calls setDatePreset with "today"', () => {
      render(<MobileFilterModal open={true} onClose={vi.fn()} />);
      fireEvent.click(screen.getByText('Hoy'));
      expect(mockSetDatePreset).toHaveBeenCalledWith('today');
    });

    it('clicking 7 días date pill calls setDatePreset with "next7"', () => {
      render(<MobileFilterModal open={true} onClose={vi.fn()} />);
      fireEvent.click(screen.getByText('7 días'));
      expect(mockSetDatePreset).toHaveBeenCalledWith('next7');
    });

    it('clicking a stage pill calls setStageFilter', () => {
      render(<MobileFilterModal open={true} onClose={vi.fn()} />);
      fireEvent.click(screen.getByText('En Bodega'));
      expect(mockSetStageFilter).toHaveBeenCalledWith('en_bodega');
    });
  });

  describe('Footer buttons', () => {
    it('renders Aplicar and Limpiar buttons', () => {
      render(<MobileFilterModal open={true} onClose={vi.fn()} />);
      expect(screen.getByText('Aplicar')).toBeTruthy();
      expect(screen.getByText('Limpiar')).toBeTruthy();
    });

    it('clicking Aplicar calls onClose', () => {
      const onClose = vi.fn();
      render(<MobileFilterModal open={true} onClose={onClose} />);
      fireEvent.click(screen.getByText('Aplicar'));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('clicking Limpiar calls clearAllFilters and onClose', () => {
      const onClose = vi.fn();
      render(<MobileFilterModal open={true} onClose={onClose} />);
      fireEvent.click(screen.getByText('Limpiar'));
      expect(mockClearAllFilters).toHaveBeenCalledOnce();
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  describe('Close button', () => {
    it('renders close button', () => {
      render(<MobileFilterModal open={true} onClose={vi.fn()} />);
      expect(screen.getByTestId('modal-close')).toBeTruthy();
    });

    it('clicking close button calls onClose', () => {
      const onClose = vi.fn();
      render(<MobileFilterModal open={true} onClose={onClose} />);
      fireEvent.click(screen.getByTestId('modal-close'));
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  describe('Active pill highlighting', () => {
    it('highlights the active statusFilter pill', () => {
      vi.mocked(useOpsControlFilterStore).mockReturnValue({
        ...defaultStoreState,
        statusFilter: 'urgent',
      });
      render(<MobileFilterModal open={true} onClose={vi.fn()} />);
      const urgentPill = screen.getByTestId('status-pill-urgent');
      expect(urgentPill.getAttribute('data-active')).toBe('true');
    });

    it('highlights the active datePreset pill', () => {
      vi.mocked(useOpsControlFilterStore).mockReturnValue({
        ...defaultStoreState,
        datePreset: 'tomorrow',
      });
      render(<MobileFilterModal open={true} onClose={vi.fn()} />);
      const tomorrowPill = screen.getByTestId('date-pill-tomorrow');
      expect(tomorrowPill.getAttribute('data-active')).toBe('true');
    });
  });
});
