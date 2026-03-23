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
    <div className="flex items-center gap-3 bg-[var(--color-status-error-bg)] border border-[var(--color-status-error-border)] rounded-lg px-4 py-3 mb-4">
      <AlertTriangle className="h-4 w-4 text-status-error shrink-0" />
      <span className="text-sm text-status-error">{message}</span>
      <button
        onClick={handleRetry}
        className="ml-auto text-sm font-medium text-status-error underline hover:opacity-80"
      >
        Reintentar
      </button>
    </div>
  );
}
