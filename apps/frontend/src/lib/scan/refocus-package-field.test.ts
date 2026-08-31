import { describe, it, expect, vi, afterEach } from 'vitest';
import { refocusPackageField, PACKAGE_FIELD_SELECTOR } from './refocus-package-field';

/**
 * These tests pin the WIRING only. They cannot prove the bug is fixed: the
 * bug is a browser focus-ordering race that jsdom does not reproduce — an
 * earlier `key={mode}` fix passed a jsdom test and still shipped broken. The
 * real proof is a Playwright pass against the deployed build.
 */
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('refocusPackageField', () => {
  it('focuses the package field on the next frame, not synchronously', () => {
    document.body.innerHTML = `
      <button id="tab">Estibar</button>
      <input aria-label="Escanear paquete" />
    `;
    const input = document.querySelector<HTMLInputElement>(PACKAGE_FIELD_SELECTOR)!;
    const button = document.getElementById('tab') as HTMLButtonElement;
    button.focus();
    expect(document.activeElement).toBe(button);

    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return 1;
    });

    refocusPackageField();
    // Deferred on purpose: focusing synchronously loses the race with the
    // click's own focus handling, which is what broke on the real build.
    expect(document.activeElement).toBe(button);

    frames.forEach((cb) => cb(0));
    expect(document.activeElement).toBe(input);
  });

  it('does not throw when the package field is absent', () => {
    document.body.innerHTML = '<button id="tab">Estibar</button>';
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return 1;
    });

    expect(() => {
      refocusPackageField();
      frames.forEach((cb) => cb(0));
    }).not.toThrow();
  });
});
