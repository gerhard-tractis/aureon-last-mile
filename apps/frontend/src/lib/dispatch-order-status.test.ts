import { describe, it, expect } from 'vitest';
import {
  getOrderStatusUpdate,
  shouldSkipOrderUpdate,
} from './dispatch-order-status';

describe('getOrderStatusUpdate', () => {
  // AC1: Delivered orders updated
  it('returns delivered status with dispatch context for delivered dispatches', () => {
    const result = getOrderStatusUpdate('delivered', 12345);
    expect(result).toEqual({
      orderStatus: 'entregado',
      statusDetail: 'Delivered via DispatchTrack dispatch #12345',
    });
  });

  // AC2: Failed orders updated — with substatus
  it('returns failed status with substatus text for failed dispatches', () => {
    const result = getOrderStatusUpdate('failed', 99, 'No se encuentra dirección');
    expect(result).toEqual({
      orderStatus: 'cancelado',
      statusDetail: 'No se encuentra dirección',
    });
  });

  // AC2: Failed orders updated — without substatus (fallback)
  it('returns failed status with fallback text when no substatus', () => {
    const result = getOrderStatusUpdate('failed', 99);
    expect(result).toEqual({
      orderStatus: 'cancelado',
      statusDetail: 'Failed via DispatchTrack dispatch #99',
    });
  });

  it('returns failed status with fallback when substatus is null', () => {
    const result = getOrderStatusUpdate('failed', 42, null);
    expect(result).toEqual({
      orderStatus: 'cancelado',
      statusDetail: 'Failed via DispatchTrack dispatch #42',
    });
  });

  // AC3: Partial deliveries treated as failed
  it('maps partial dispatch to failed order status', () => {
    const result = getOrderStatusUpdate('partial', 55);
    expect(result).toEqual({
      orderStatus: 'cancelado',
      statusDetail: 'Partial delivery via DispatchTrack dispatch #55',
    });
  });

  it('includes substatus in partial delivery detail', () => {
    const result = getOrderStatusUpdate('partial', 55, 'Cliente ausente');
    expect(result).toEqual({
      orderStatus: 'cancelado',
      statusDetail: 'Partial delivery via DispatchTrack dispatch #55 — Cliente ausente',
    });
  });

  // AC4: Pending dispatches don't update orders
  it('returns null for pending dispatches', () => {
    const result = getOrderStatusUpdate('pending', 100);
    expect(result).toBeNull();
  });
});

describe('shouldSkipOrderUpdate', () => {
  // AC1/AC2: Idempotency — don't downgrade from delivered
  it('skips update when order is already delivered', () => {
    expect(shouldSkipOrderUpdate('entregado', 'cancelado')).toBe(true);
    expect(shouldSkipOrderUpdate('entregado', 'entregado')).toBe(true);
  });

  it('allows update from pending to delivered', () => {
    expect(shouldSkipOrderUpdate('ingresado', 'entregado')).toBe(false);
  });

  it('allows update from pending to failed', () => {
    expect(shouldSkipOrderUpdate('ingresado', 'cancelado')).toBe(false);
  });

  it('allows update from failed to delivered', () => {
    expect(shouldSkipOrderUpdate('cancelado', 'entregado')).toBe(false);
  });

  it('allows update from processing to failed', () => {
    expect(shouldSkipOrderUpdate('asignado', 'cancelado')).toBe(false);
  });

  it('allows update from dispatched to delivered', () => {
    expect(shouldSkipOrderUpdate('en_ruta', 'entregado')).toBe(false);
  });
});
