'use client';

import { useMemo } from 'react';
import bwipjs from 'bwip-js/browser';
import type { ManifestLabelRow } from '@/lib/pickup/manifest-label-types';

interface PackageLabelProps {
  data: ManifestLabelRow;
}

// spec-53 — one 100×100mm label per `packages` row. The crew matches this
// label to a physical box BY EYE against the retailer's own tracking number,
// so package_label is the visually dominant element (see spec's "How the
// label reaches the right box"). The barcode payload is packages.label
// verbatim — no new identity, so no scan-logic change is needed anywhere.
export function PackageLabel({ data }: PackageLabelProps) {
  const svg = useMemo(() => {
    const raw = bwipjs.toSVG({
      bcid: 'code128',
      text: data.package_label,
      includetext: false,
      height: 13,
      paddingwidth: 4,
    });
    // Same fix as DockLabel.tsx: bwip-js emits <svg viewBox=...> with no
    // width/height attrs, so preserveAspectRatio="none" + explicit sizing is
    // required or the barcode keeps its intrinsic ratio and overflows.
    return raw.replace(
      /<svg\b/,
      '<svg preserveAspectRatio="none" width="100%" height="100%"',
    );
  }, [data.package_label]);

  const bultoLine = data.declared_box_count != null
    ? `Bulto ${data.package_number ?? '1'} de ${data.declared_box_count}`
    : null;

  const visibleSkus = data.sku_items.slice(0, 2);
  const hiddenCount = data.sku_items.length - visibleSkus.length;

  return (
    <section
      className="package-label"
      style={{
        width: '100mm',
        height: '100mm',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
        color: '#111',
        background: '#fff',
      }}
    >
      {/* Top band — manifest ID, readable when labels are fanned straight
          out of the printer, before anyone separates the stack. */}
      <header
        style={{
          background: '#111',
          color: '#fff',
          padding: '3mm 4mm',
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ fontSize: '2mm', letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.75 }}>
            Manifiesto
          </div>
          <div style={{ fontFamily: 'Courier New, monospace', fontSize: '7mm', fontWeight: 700, lineHeight: 1 }}>
            {data.external_load_id}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '2mm', letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.75 }}>
            Aureon
          </div>
          <div style={{ fontSize: '3mm', fontWeight: 600 }}>{data.retailer_name ?? '—'}</div>
        </div>
      </header>

      {/* Match block — the eye-match key. Misreading this puts the wrong
          label on the wrong box, so package_label is the biggest text on
          the label. */}
      <div style={{ padding: '3mm 4mm 1mm' }}>
        <div style={{ fontSize: '2mm', letterSpacing: 1, textTransform: 'uppercase', color: '#666' }}>
          Etiqueta del cliente
        </div>
        <div
          style={{
            fontFamily: 'Courier New, monospace',
            fontSize: '8.5mm',
            fontWeight: 700,
            lineHeight: 1.05,
            wordBreak: 'break-all',
          }}
        >
          {data.package_label}
        </div>
        <div style={{ fontSize: '3mm', color: '#333', marginTop: '0.5mm' }}>
          {bultoLine && <span>{bultoLine}</span>}
          {bultoLine && ' · '}
          <span>{data.order_number}</span>
        </div>
      </div>

      {/* Barcode — full width Code128 of package_label. */}
      <div style={{ padding: '0 4mm' }}>
        <div
          style={{ width: '100%', height: '13mm' }}
          aria-label={`Código de barras Code128: ${data.package_label}`}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>

      <div style={{ borderTop: '1mm solid #111', margin: '1mm 4mm 0' }} />

      {/* Destination */}
      <div style={{ padding: '2mm 4mm 1mm' }}>
        <div style={{ fontSize: '5.6mm', fontWeight: 700, lineHeight: 1.1 }}>{data.comuna}</div>
        <div style={{ fontSize: '3.9mm', fontWeight: 600 }}>{data.customer_name}</div>
        <div
          style={{
            fontSize: '3.2mm',
            color: '#333',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {data.delivery_address}
        </div>
        <div style={{ fontSize: '3.2mm', color: '#333' }}>{data.customer_phone}</div>
      </div>

      <div style={{ borderTop: '0.3mm solid #ccc', margin: '0 4mm' }} />

      {/* Contents — lowest priority, always retrievable in the app. */}
      <div style={{ padding: '1.5mm 4mm 2mm', flex: 1, overflow: 'hidden' }}>
        <div style={{ fontSize: '2mm', letterSpacing: 1, textTransform: 'uppercase', color: '#666' }}>
          Contenido
        </div>
        {visibleSkus.map((item, i) => (
          <div key={`${item.sku}-${i}`} style={{ fontSize: '2.5mm', color: '#333' }}>
            {item.quantity}× {item.description}
          </div>
        ))}
        {hiddenCount > 0 && (
          <div style={{ fontSize: '2.5mm', color: '#666' }}>+{hiddenCount} ítems más</div>
        )}
      </div>
    </section>
  );
}
