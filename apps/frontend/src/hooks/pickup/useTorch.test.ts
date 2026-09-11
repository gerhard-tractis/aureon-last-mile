import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTorch } from './useTorch';

/**
 * Fase 9, spec-95, review de `6817496` — el hook se extrajo justamente para
 * poder testear la lectura de capacidad sin montar `ManifestCameraSheet`
 * entera (cámara, `<video>`, canvas, fallback...).
 */
describe('useTorch', () => {
  // B1, bloqueante del review — `'torch' in capabilities` es cierto
  // también cuando el valor es `false`, que es EXACTAMENTE cómo Chromium
  // declara "esta pista no tiene linterna" (cámara frontal de Android,
  // webcam de escritorio). Sólo `torch === true` es soporte real.
  describe('B1 — torch: false no es soporte', () => {
    it('reports supported when the track capabilities report torch: true', () => {
      const { result } = renderHook(() => useTorch());
      act(() => {
        result.current.registerTrack({ getCapabilities: () => ({ torch: true }) });
      });
      expect(result.current.torchSupported).toBe(true);
    });

    it('does NOT report supported when the track capabilities report torch: false', () => {
      const { result } = renderHook(() => useTorch());
      act(() => {
        result.current.registerTrack({ getCapabilities: () => ({ torch: false }) });
      });
      expect(result.current.torchSupported).toBe(false);
    });

    it('does not report supported when the capabilities object has no torch key at all', () => {
      const { result } = renderHook(() => useTorch());
      act(() => {
        result.current.registerTrack({ getCapabilities: () => ({}) });
      });
      expect(result.current.torchSupported).toBe(false);
    });

    it('does not report supported, and does not throw, when the track has no getCapabilities method', () => {
      const { result } = renderHook(() => useTorch());
      expect(() => {
        act(() => {
          result.current.registerTrack({});
        });
      }).not.toThrow();
      expect(result.current.torchSupported).toBe(false);
    });
  });

  // B2, bloqueante del review — un `ConstraintSet` dentro de `advanced` es
  // best-effort: el UA lo salta si no puede satisfacerlo y la promesa
  // IGUAL resuelve. Sin `advanced`, es un constraint básico: si el track
  // no soporta `torch`, `applyConstraints` rechaza de verdad.
  describe('B2 — el constraint va sin envolver en advanced', () => {
    it('calls applyConstraints with a bare { torch } constraint, not wrapped in advanced', async () => {
      const applyConstraints = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useTorch());
      act(() => {
        result.current.registerTrack({ getCapabilities: () => ({ torch: true }) });
      });

      await act(async () => {
        result.current.toggleTorch({ applyConstraints });
      });

      expect(applyConstraints).toHaveBeenCalledWith({ torch: true });
    });

    it('flips torchOn only after applyConstraints resolves', async () => {
      const applyConstraints = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useTorch());
      expect(result.current.torchOn).toBe(false);

      await act(async () => {
        result.current.toggleTorch({ applyConstraints });
      });

      expect(result.current.torchOn).toBe(true);
      await act(async () => {
        result.current.toggleTorch({ applyConstraints });
      });
      expect(applyConstraints).toHaveBeenLastCalledWith({ torch: false });
      expect(result.current.torchOn).toBe(false);
    });

    it('does not flip torchOn when the device genuinely rejects the constraint', async () => {
      const applyConstraints = vi.fn().mockRejectedValue(new Error('OverconstrainedError'));
      const { result } = renderHook(() => useTorch());

      await act(async () => {
        result.current.toggleTorch({ applyConstraints });
      });

      expect(result.current.torchOn).toBe(false);
    });

    it('does nothing, and does not throw, when the track has no applyConstraints method', () => {
      const { result } = renderHook(() => useTorch());
      expect(() => {
        act(() => {
          result.current.toggleTorch({});
        });
      }).not.toThrow();
      expect(result.current.torchOn).toBe(false);
    });

    it('does nothing when the track is null', () => {
      const { result } = renderHook(() => useTorch());
      act(() => {
        result.current.toggleTorch(null);
      });
      expect(result.current.torchOn).toBe(false);
    });
  });

  // M1 del review — la pista puede morir o silenciarse con el flash
  // encendido. La UI no puede seguir diciendo "encendido" sobre hardware
  // que ya no está prendiendo nada.
  describe('M1 — la pista se cae con el flash encendido', () => {
    it('handleTrackDown (mute) turns torchOn off but keeps torchSupported', async () => {
      const applyConstraints = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useTorch());
      act(() => {
        result.current.registerTrack({ getCapabilities: () => ({ torch: true }) });
      });
      await act(async () => {
        result.current.toggleTorch({ applyConstraints });
      });
      expect(result.current.torchOn).toBe(true);

      act(() => {
        result.current.handleTrackDown();
      });

      expect(result.current.torchOn).toBe(false);
      expect(result.current.torchSupported).toBe(true);
    });

    it('handleTrackEnded turns torchOn off AND torchSupported off — the track is gone for good', async () => {
      const applyConstraints = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useTorch());
      act(() => {
        result.current.registerTrack({ getCapabilities: () => ({ torch: true }) });
      });
      await act(async () => {
        result.current.toggleTorch({ applyConstraints });
      });
      expect(result.current.torchOn).toBe(true);

      act(() => {
        result.current.handleTrackEnded();
      });

      expect(result.current.torchOn).toBe(false);
      expect(result.current.torchSupported).toBe(false);
    });
  });

  describe('reset — sin fuga entre aperturas', () => {
    it('clears both torchSupported and torchOn', async () => {
      const applyConstraints = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useTorch());
      act(() => {
        result.current.registerTrack({ getCapabilities: () => ({ torch: true }) });
      });
      await act(async () => {
        result.current.toggleTorch({ applyConstraints });
      });
      expect(result.current.torchSupported).toBe(true);
      expect(result.current.torchOn).toBe(true);

      act(() => {
        result.current.reset();
      });

      expect(result.current.torchSupported).toBe(false);
      expect(result.current.torchOn).toBe(false);
    });
  });
});
