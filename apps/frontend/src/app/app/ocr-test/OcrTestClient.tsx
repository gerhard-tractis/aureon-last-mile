'use client';

import { useState, useRef, useCallback } from 'react';
import { Camera, X, Loader2, ScanText, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useCameraIntake } from '@/hooks/pickup/useCameraIntake';

// ── Types ──────────────────────────────────────────────────────────────────────
interface ExtractedPackage {
  label: string;
  package_number: string | null;
  declared_box_count: number;
  declared_weight_kg: number | null;
}

interface ExtractedOrder {
  order_number: string;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  comuna: string | null;
  delivery_date: string | null;
  packages: ExtractedPackage[];
}

interface ExtractionResult {
  pickup_point_code: string | null;
  pickup_point_name: string | null;
  orders: ExtractedOrder[];
  error?: string;
}

interface OcrTestClientProps {
  pickupPoints?: { id: string; name: string; code: string }[];
}

// ── Image compression ─────────────────────────────────────────────────────────
const MAX_DIMENSION = 1600; // px — enough for OCR, keeps files ~200-400 KB
const JPEG_QUALITY = 0.82;

function compressImage(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const scale = MAX_DIMENSION / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('Canvas compression failed'));
          resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }));
        },
        'image/jpeg',
        JPEG_QUALITY,
      );
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

// ── OrderCard ──────────────────────────────────────────────────────────────────
export function OrderCard({ order, index }: { order: ExtractedOrder; index: number }) {
  const [open, setOpen] = useState(index === 0);

  return (
    <Card className="border border-border">
      <CardHeader
        className="py-3 px-4 cursor-pointer select-none"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-xs">#{index + 1}</Badge>
            <span className="font-semibold text-sm text-text">{order.order_number}</span>
            {order.customer_name && (
              <span className="text-text-secondary text-sm">{order.customer_name}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              {order.packages.length} bulto{order.packages.length !== 1 ? 's' : ''}
            </Badge>
            {open ? (
              <ChevronUp className="size-4 text-text-secondary" />
            ) : (
              <ChevronDown className="size-4 text-text-secondary" />
            )}
          </div>
        </div>
      </CardHeader>

      {open && (
        <CardContent className="pb-4 px-4 pt-0 space-y-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {order.delivery_address && (
              <>
                <span className="text-text-secondary">Dirección</span>
                <span className="text-text">{order.delivery_address}</span>
              </>
            )}
            {order.comuna && (
              <>
                <span className="text-text-secondary">Comuna</span>
                <span className="text-text">{order.comuna}</span>
              </>
            )}
            {order.customer_phone && (
              <>
                <span className="text-text-secondary">Teléfono</span>
                <span className="text-text font-mono">{order.customer_phone}</span>
              </>
            )}
            {order.delivery_date && (
              <>
                <span className="text-text-secondary">Fecha entrega</span>
                <span className="text-text font-mono">{order.delivery_date}</span>
              </>
            )}
          </div>
          {order.packages.length > 0 && (
            <div className="mt-2 rounded-md bg-surface-raised p-2 space-y-1">
              {order.packages.map((pkg, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-text">{pkg.label}</span>
                  <span className="text-text-secondary">
                    {pkg.declared_box_count} caja{pkg.declared_box_count !== 1 ? 's' : ''}
                    {pkg.declared_weight_kg ? ` · ${pkg.declared_weight_kg} kg` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ── OcrTestClient ──────────────────────────────────────────────────────────────
export default function OcrTestClient({ pickupPoints = [] }: OcrTestClientProps) {
  const [photos, setPhotos] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [selectedPickupPointId, setSelectedPickupPointId] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const intake = useCameraIntake();

  const extraction = intake.result?.parsedData as ExtractionResult | null;
  const rawJson = extraction ? JSON.stringify(extraction, null, 2) : '';

  const addPhoto = useCallback(async (file: File) => {
    const compressed = await compressImage(file);
    setPhotos((prev) => [...prev, compressed]);
    setPreviews((prev) => [...prev, URL.createObjectURL(compressed)]);
  }, []);

  const removePhoto = useCallback((idx: number) => {
    setPreviews((prev) => {
      URL.revokeObjectURL(prev[idx]);
      return prev.filter((_, i) => i !== idx);
    });
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const reset = useCallback(() => {
    previews.forEach((url) => URL.revokeObjectURL(url));
    setPhotos([]);
    setPreviews([]);
    setShowRaw(false);
    intake.reset();
  }, [previews, intake]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await addPhoto(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const runOcr = async () => {
    if (photos.length === 0 || !selectedPickupPointId) return;
    await intake.submit(photos, selectedPickupPointId);
  };

  const isProcessing = intake.status === 'uploading' || intake.status === 'processing';

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ScanText className="size-6 text-accent" />
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-text">OCR Test</h1>
            <Badge variant="outline" className="text-xs text-text-secondary">Dev Tool</Badge>
          </div>
          <p className="text-sm text-text-secondary">
            Sube fotos de un manifiesto y ve qué extrae Gemini 2.5 Flash
          </p>
        </div>
      </div>

      {/* Pickup point selector */}
      <select
        value={selectedPickupPointId}
        onChange={(e) => setSelectedPickupPointId(e.target.value)}
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
      >
        <option value="">Seleccionar punto de retiro…</option>
        {pickupPoints.map((pp) => (
          <option key={pp.id} value={pp.id}>
            {pp.code} — {pp.name}
          </option>
        ))}
      </select>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Photo strip or empty state */}
      {previews.length > 0 ? (
        <div className="flex gap-2 flex-wrap">
          {previews.map((url, i) => (
            <div key={i} className="relative group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`Foto ${i + 1}`}
                className="h-24 w-20 object-cover rounded-lg border border-border"
              />
              <button
                aria-label={`Eliminar foto ${i + 1}`}
                onClick={() => removePhoto(i)}
                className="absolute -top-1.5 -right-1.5 size-5 rounded-full bg-destructive text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
          <button
            aria-label="Agregar foto"
            onClick={() => fileInputRef.current?.click()}
            className="h-24 w-20 rounded-lg border-2 border-dashed border-border flex items-center justify-center text-text-secondary hover:border-accent hover:text-accent transition-colors"
          >
            <Camera className="size-5" />
          </button>
        </div>
      ) : (
        <div className="rounded-lg border-2 border-dashed border-border p-8 text-center text-text-secondary">
          Sin fotos aún
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        {photos.length === 0 ? (
          <Button onClick={() => fileInputRef.current?.click()} className="gap-2">
            <Camera className="size-4" />
            Abrir cámara
          </Button>
        ) : (
          <>
            <Button
              onClick={runOcr}
              disabled={isProcessing || !selectedPickupPointId}
              className="gap-2"
            >
              {intake.status === 'uploading' ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Subiendo {intake.uploadProgress?.current}/{intake.uploadProgress?.total}…
                </>
              ) : intake.status === 'processing' ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Procesando manifiesto…
                </>
              ) : (
                <>
                  <ScanText className="size-4" />
                  Extraer datos
                </>
              )}
            </Button>
            <Button variant="ghost" onClick={reset} className="gap-2 text-text-secondary">
              <Trash2 className="size-4" />
              Limpiar
            </Button>
          </>
        )}
      </div>

      {/* Error */}
      {intake.status === 'error' && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
          {intake.error}
        </div>
      )}

      {/* Results */}
      {intake.status === 'success' && extraction && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-text">
                {extraction.orders.length} orden{extraction.orders.length !== 1 ? 'es' : ''} encontrada
                {extraction.orders.length !== 1 ? 's' : ''}
              </span>
              {(extraction.pickup_point_code || extraction.pickup_point_name) && (
                <Badge variant="secondary" className="text-xs font-mono">
                  {[extraction.pickup_point_code, extraction.pickup_point_name].filter(Boolean).join(' · ')}
                </Badge>
              )}
              {extraction.error && (
                <Badge variant="destructive" className="text-xs">{extraction.error}</Badge>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-text-secondary"
              onClick={() => setShowRaw((v) => !v)}
            >
              {showRaw ? 'Ocultar JSON' : 'Ver JSON'}
            </Button>
          </div>

          {showRaw && (
            <pre className="rounded-lg bg-surface-raised p-4 text-xs font-mono text-text overflow-auto max-h-80">
              {rawJson}
            </pre>
          )}

          <div className="space-y-3">
            {extraction.orders.map((order, i) => (
              <OrderCard key={order.order_number} order={order} index={i} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
