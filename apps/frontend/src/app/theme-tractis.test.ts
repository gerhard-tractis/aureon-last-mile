import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Theme Tractis CSS class', () => {
  const globalsPath = path.resolve(__dirname, 'globals.css');
  const cssContent = fs.readFileSync(globalsPath, 'utf-8');

  it('should define .theme-tractis class', () => {
    expect(cssContent).toContain('.theme-tractis');
  });

  it('should set gold primary color ramp', () => {
    // Extract theme-tractis block
    const themeMatch = cssContent.match(/\.theme-tractis\s*\{([^}]+)\}/s);
    expect(themeMatch).toBeTruthy();
    const themeBlock = themeMatch![1];

    // Primary gold ramp
    expect(themeBlock).toContain('--color-primary-500');
    expect(themeBlock).toContain('--color-primary-600');
    expect(themeBlock).toContain('#e6c15c'); // gold-500
    expect(themeBlock).toContain('#ca9a04'); // gold-600
  });

  it('should set secondary slate ramp', () => {
    const themeMatch = cssContent.match(/\.theme-tractis\s*\{([^}]+)\}/s);
    const themeBlock = themeMatch![1];

    expect(themeBlock).toContain('--color-secondary-50');
    expect(themeBlock).toContain('--color-secondary-900');
    expect(themeBlock).toContain('#f8fafc'); // slate-50
    expect(themeBlock).toContain('#1e293b'); // slate-900
  });

  it('should have primary-600 dark enough for contrast (#ca9a04)', () => {
    const themeMatch = cssContent.match(/\.theme-tractis\s*\{([^}]+)\}/s);
    const themeBlock = themeMatch![1];

    // primary-600 should be #ca9a04 (dark gold for buttons)
    const primary600Match = themeBlock.match(/--color-primary-600:\s*(#[0-9a-fA-F]+)/);
    expect(primary600Match).toBeTruthy();
    expect(primary600Match![1].toLowerCase()).toBe('#ca9a04');
  });
});
