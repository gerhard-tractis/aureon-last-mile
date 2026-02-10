/**
 * Tests for Offline Fallback Page
 * Target: 90% coverage (8 tests)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OfflinePage from './page';

describe('OfflinePage', () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders the offline icon SVG', () => {
      const { container } = render(<OfflinePage />);

      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveClass('mx-auto', 'h-16', 'w-16', 'text-gray-400');
    });

    it('displays Spanish heading "Sin Conexión"', () => {
      render(<OfflinePage />);

      const heading = screen.getByRole('heading', { name: /sin conexión/i });
      expect(heading).toBeInTheDocument();
      expect(heading).toHaveClass('text-2xl', 'font-bold', 'text-gray-900');
    });

    it('displays offline mode information in Spanish', () => {
      render(<OfflinePage />);

      expect(screen.getByText(/No se pudo conectar al servidor/i)).toBeInTheDocument();
      expect(screen.getByText(/Modo Offline/i)).toBeInTheDocument();
      expect(screen.getByText(/Los escaneos se sincronizarán automáticamente/i)).toBeInTheDocument();
    });

    it('displays both action buttons', () => {
      render(<OfflinePage />);

      const retryButton = screen.getByRole('button', { name: /reintentar conexión/i });
      const backButton = screen.getByRole('button', { name: /volver/i });

      expect(retryButton).toBeInTheDocument();
      expect(backButton).toBeInTheDocument();
    });
  });

  describe('Button Interactions', () => {
    it('"Reintentar Conexión" button calls window.location.reload()', async () => {
      const user = userEvent.setup();
      render(<OfflinePage />);

      const retryButton = screen.getByRole('button', { name: /reintentar conexión/i });
      await user.click(retryButton);

      expect(window.location.reload).toHaveBeenCalledTimes(1);
    });

    it('"Volver" button calls window.history.back()', async () => {
      const user = userEvent.setup();
      render(<OfflinePage />);

      const backButton = screen.getByRole('button', { name: /volver/i });
      await user.click(backButton);

      expect(window.history.back).toHaveBeenCalledTimes(1);
    });
  });

  describe('Styling', () => {
    it('retry button has correct primary styling', () => {
      render(<OfflinePage />);

      const retryButton = screen.getByRole('button', { name: /reintentar conexión/i });
      expect(retryButton).toHaveClass('bg-blue-600', 'text-white');
    });

    it('back button has correct secondary styling', () => {
      render(<OfflinePage />);

      const backButton = screen.getByRole('button', { name: /volver/i });
      expect(backButton).toHaveClass('border', 'border-gray-300', 'bg-white');
    });
  });
});
