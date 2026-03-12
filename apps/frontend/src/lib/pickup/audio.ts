type FeedbackType = 'verified' | 'not_found' | 'duplicate';

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

function beep(frequency: number, durationMs: number): void {
  try {
    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.frequency.value = frequency;
    oscillator.type = 'square';
    gain.gain.value = 0.3;
    oscillator.start();
    oscillator.stop(ctx.currentTime + durationMs / 1000);
  } catch {
    // Audio not available — silent fallback
  }
}

function haptic(pattern: number[]): void {
  try {
    if (navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  } catch {
    // Haptic not available — silent fallback
  }
}

export function playFeedback(type: FeedbackType): void {
  switch (type) {
    case 'verified':
      // Single beep, 800Hz, 150ms + 1 haptic pulse
      beep(800, 150);
      haptic([100]);
      break;
    case 'not_found':
      // Triple beep, 400Hz, 200ms each + 3 haptic pulses
      beep(400, 200);
      setTimeout(() => beep(400, 200), 300);
      setTimeout(() => beep(400, 200), 600);
      haptic([100, 100, 100, 100, 100]);
      break;
    case 'duplicate':
      // Double beep, 600Hz, 200ms each + 2 haptic pulses
      beep(600, 200);
      setTimeout(() => beep(600, 200), 300);
      haptic([100, 100, 100]);
      break;
  }
}
