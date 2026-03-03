'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

interface DashboardErrorBannerProps {
  message?: string;
}

export default function DashboardErrorBanner({
  message = 'Los datos pueden estar desactualizados',
}: DashboardErrorBannerProps) {
  const queryClient = useQueryClient();

  useEffect(() => {
    toast.error(message);
  }, [message]);

  const handleRetry = () => {
    queryClient.refetchQueries({ queryKey: ['dashboard'], type: 'active' });
  };

  return (
    <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
      <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
      <span className="text-sm text-red-700">{message}</span>
      <button
        onClick={handleRetry}
        className="ml-auto text-sm font-medium text-red-700 underline hover:text-red-900"
      >
        Reintentar
      </button>
    </div>
  );
}
