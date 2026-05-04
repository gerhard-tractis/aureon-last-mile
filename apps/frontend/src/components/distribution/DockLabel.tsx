'use client';

import { useMemo } from 'react';
import bwipjs from 'bwip-js/browser';

interface DockLabelProps {
  code: string;
  name: string;
  compact?: boolean;
}

export function DockLabel({ code, name, compact = false }: DockLabelProps) {
  const svg = useMemo(() => {
    const raw = bwipjs.toSVG({
      bcid: 'code128',
      text: code,
      includetext: false,
      height: 30,
      paddingwidth: 4,
    });
    // bwip-js emits <svg viewBox=...> with no width/height attrs, so the SVG
    // would otherwise keep its intrinsic ~232×72 ratio — overflowing the
    // wrapper in both compact (modal preview) and non-compact (print) modes.
    // Inject explicit sizing; preserveAspectRatio="none" is safe for Code128
    // since uniform horizontal scaling preserves bar-width ratios.
    return raw.replace(
      /<svg\b/,
      '<svg preserveAspectRatio="none" width="100%" height="100%"',
    );
  }, [code, compact]);

  return (
    <section
      className="dock-label"
      style={{
        width: '100%',
        height: compact ? 'auto' : '100vh',
        display: 'flex',
        flexDirection: 'column',
        padding: compact ? '16px 20px' : '28px 32px',
        boxSizing: 'border-box',
        fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
        color: '#111',
        background: '#fff',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          borderBottom: '2px solid #111',
          paddingBottom: 10,
        }}
      >
        <span style={{ fontSize: 13, letterSpacing: 4, color: '#666', textTransform: 'uppercase' }}>
          Andén
        </span>
        <span style={{ fontSize: compact ? 18 : 28, fontWeight: 700, lineHeight: 1 }}>{name}</span>
      </header>

      <div style={{ textAlign: 'center', padding: '12px 0 0' }}>
        <div
          style={{
            fontSize: compact ? 52 : 96,
            fontWeight: 800,
            lineHeight: 1,
            letterSpacing: -2,
          }}
        >
          {code}
        </div>
      </div>

      {!compact && <div style={{ flex: '0 0 56px' }} aria-hidden="true" />}

      <div style={{ marginTop: compact ? 12 : 0 }}>
        <div
          style={{ width: '100%', height: compact ? 80 : 170 }}
          aria-label={`Código de barras Code128: ${code}`}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <div
          style={{
            fontFamily: 'Courier New, monospace',
            fontSize: compact ? 13 : 22,
            letterSpacing: compact ? 6 : 12,
            textAlign: 'center',
            marginTop: 8,
            color: '#222',
          }}
        >
          {code}
        </div>
      </div>
    </section>
  );
}
