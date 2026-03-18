'use client';

import { useState } from 'react';
import { QrCode } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { ReceptionList } from '@/components/reception/ReceptionList';
import { QRScanner } from '@/components/reception/QRScanner';
import { useReceptionManifests } from '@/hooks/reception/useReceptionManifests';
import { useOperatorId } from '@/hooks/useOperatorId';

export default function ReceptionPage() {
  const { operatorId } = useOperatorId();
  const { data: manifests, isLoading } = useReceptionManifests(operatorId);
  const [showScanner, setShowScanner] = useState(false);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Recepción</h1>
        <button
          onClick={() => setShowScanner(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white
                     rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <QrCode className="h-4 w-4" />
          Escanear QR
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <ReceptionList manifests={manifests ?? []} />
      )}

      {showScanner && operatorId && (
        <QRScanner
          onClose={() => setShowScanner(false)}
          operatorId={operatorId}
        />
      )}
    </div>
  );
}
