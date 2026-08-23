import { describe, it, expect } from 'vitest';
import { displayForOrderStatus, ORDER_STATUS_DISPLAY } from './order-status-display';

/**
 * spec-65 Task 5 — Spanish label + StatusBadge variant for every
 * `order_status_enum` value, kept OUT of the shared `StatusBadge.tsx`
 * STATUS_CONFIG on purpose: that map is already fed raw enum values by
 * PackageStatusBreakdown, which asserts (in its own tests) that an unmapped
 * status falls through to the raw string. Adding these keys there would
 * silently change that component's rendered text. This module is imported
 * only by the Pedidos screen instead.
 */
describe('displayForOrderStatus', () => {
  it('maps every declared order_status_enum value to a non-empty Spanish label', () => {
    const enumValues = [
      'ingresado', 'verificado', 'en_bodega', 'asignado', 'en_carga',
      'listo_para_despacho', 'en_ruta', 'entregado', 'cancelado',
      'en_retorno', 'parcialmente_entregado',
    ];
    for (const status of enumValues) {
      const display = displayForOrderStatus(status);
      expect(display.label.length).toBeGreaterThan(0);
      expect(display.label).not.toBe(status);
    }
  });

  it('labels en_ruta "En reparto", matching the Pedidos filter-chip vocabulary', () => {
    expect(displayForOrderStatus('en_ruta').label).toBe('En reparto');
  });

  it('labels entregado "Entregada" with the success variant', () => {
    const display = displayForOrderStatus('entregado');
    expect(display.label).toBe('Entregada');
    expect(display.variant).toBe('success');
  });

  it('falls back to the raw status string, not a placeholder, for an unknown value', () => {
    const display = displayForOrderStatus('some_future_status');
    expect(display.label).toBe('some_future_status');
    expect(display.variant).toBe('neutral');
  });

  it('exports the map read-only so no caller can mutate a shared entry', () => {
    expect(Object.isFrozen(ORDER_STATUS_DISPLAY)).toBe(true);
  });
});
