import { describe, it, expect, vi, beforeEach } from 'vitest';

// Track all created oscillators
const createdOscillators: Array<{ frequency: { value: number }; type: string }> = [];

const mockGain = {
  connect: vi.fn(),
  gain: { value: 0 },
};

const mockAudioCtx = {
  createOscillator: vi.fn(() => {
    const osc = {
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      frequency: { value: 0 },
      type: 'sine' as OscillatorType,
    };
    createdOscillators.push(osc);
    return osc;
  }),
  createGain: vi.fn(() => mockGain),
  destination: {},
  currentTime: 0,
};

vi.stubGlobal(
  'AudioContext',
  function AudioContext() {
    return mockAudioCtx;
  }
);

describe('playFeedback', () => {
  beforeEach(() => {
    createdOscillators.length = 0;
    Object.defineProperty(navigator, 'vibrate', {
      value: vi.fn(),
      writable: true,
      configurable: true,
    });
  });

  it('plays 800Hz beep for verified', async () => {
    // Dynamic import to avoid module caching issues
    const { playFeedback } = await import('./audio');
    playFeedback('verified');
    const lastOsc = createdOscillators[createdOscillators.length - 1];
    expect(lastOsc).toBeDefined();
    expect(lastOsc.frequency.value).toBe(800);
  });

  it('plays 400Hz beep for not_found', async () => {
    const { playFeedback } = await import('./audio');
    playFeedback('not_found');
    const lastOsc = createdOscillators[createdOscillators.length - 1];
    expect(lastOsc).toBeDefined();
    expect(lastOsc.frequency.value).toBe(400);
  });

  it('plays 600Hz beep for duplicate', async () => {
    const { playFeedback } = await import('./audio');
    playFeedback('duplicate');
    const lastOsc = createdOscillators[createdOscillators.length - 1];
    expect(lastOsc).toBeDefined();
    expect(lastOsc.frequency.value).toBe(600);
  });

  it('triggers haptic feedback for verified', async () => {
    const { playFeedback } = await import('./audio');
    playFeedback('verified');
    expect(navigator.vibrate).toHaveBeenCalledWith([100]);
  });
});
