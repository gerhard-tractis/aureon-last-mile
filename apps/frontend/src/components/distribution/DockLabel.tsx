'use client';

import { useMemo } from 'react';
import bwipjs from 'bwip-js/browser';

interface DockLabelProps {
  code: string;
  name: string;
}

export function DockLabel({ code, name }: DockLabelProps) {
  const svg = useMemo(
    () =>
      bwipjs.toSVG({
        bcid: 'code128',
        text: code,
        includetext: false,
        height: 30,
        paddingwidth: 4,
      }),
    [code],
  );

  return (
    <section
      className="dock-label"
      style={{
        width: '100%',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        padding: '28px 32px',
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
        <span style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>{name}</span>
      </header>

      <div style={{ textAlign: 'center', padding: '16px 0 0' }}>
        <div
          style={{
            fontSize: 96,
            fontWeight: 800,
            lineHeight: 1,
            letterSpacing: -2,
          }}
        >
          {code}
        </div>
      </div>

      <div style={{ flex: '0 0 56px' }} aria-hidden="true" />

      <div>
        <div
          style={{ width: '100%', height: 170 }}
          aria-label={`Código de barras Code128: ${code}`}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <div
          style={{
            fontFamily: 'Courier New, monospace',
            fontSize: 22,
            letterSpacing: 12,
            textAlign: 'center',
            marginTop: 12,
            color: '#222',
          }}
        >
          {code}
        </div>
      </div>
    </section>
  );
}
