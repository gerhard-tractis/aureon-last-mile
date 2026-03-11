'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Package, ShoppingCart } from 'lucide-react';

interface ManifestCardProps {
  externalLoadId: string;
  retailerName: string | null;
  orderCount: number;
  packageCount: number;
  completedAt?: string;
  onClick: () => void;
}

export function ManifestCard({
  externalLoadId,
  retailerName,
  orderCount,
  packageCount,
  completedAt,
  onClick,
}: ManifestCardProps) {
  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">
              {retailerName || 'Unknown Retailer'}
            </h3>
            <p className="text-sm text-gray-500">{externalLoadId}</p>
          </div>
          <div className="flex gap-4 text-sm text-gray-600">
            <div className="flex items-center gap-1">
              <ShoppingCart className="h-4 w-4" />
              <span>{orderCount}</span>
            </div>
            <div className="flex items-center gap-1">
              <Package className="h-4 w-4" />
              <span>{packageCount}</span>
            </div>
          </div>
        </div>
        {completedAt && (
          <p className="text-xs text-gray-400 mt-2">
            Completed {new Date(completedAt).toLocaleDateString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
