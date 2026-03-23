'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SignaturePad } from '@/components/pickup/SignaturePad';
import { usePickupScans } from '@/hooks/pickup/usePickupScans';
import { useMissingPackages } from '@/hooks/pickup/useDiscrepancies';
import { useOperatorId } from '@/hooks/useOperatorId';
import { createSPAClient } from '@/lib/supabase/client';
import { CheckCircle, XCircle, Target, Shield } from 'lucide-react';
import { PickupStepBreadcrumb } from '@/components/pickup/PickupStepBreadcrumb';

export default function CompletionPage() {
  const params = useParams();
  const router = useRouter();
  const loadId = decodeURIComponent(params.loadId as string);
  const { operatorId } = useOperatorId();

  const [manifestId, setManifestId] = useState<string | null>(null);
  const [manifestStartedAt, setManifestStartedAt] = useState<string | null>(
    null
  );
  const [operatorName, setOperatorName] = useState('');
  const [operatorSignature, setOperatorSignature] = useState<string | null>(
    null
  );
  const [showClientSig, setShowClientSig] = useState(false);
  const [clientName, setClientName] = useState('');
  const [clientSignature, setClientSignature] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!operatorId) return;
    const supabase = createSPAClient();
    supabase
      .from('manifests')
      .select('id, started_at')
      .eq('operator_id', operatorId)
      .eq('external_load_id', loadId)
      .is('deleted_at', null)
      .single()
      .then(({ data }) => {
        if (data) {
          setManifestId(data.id);
          setManifestStartedAt(data.started_at);
        }
      });
    // Get user full name for operator signature
    supabase.auth.getUser().then(({ data }) => {
      const userId = data.user?.id;
      if (userId) {
        supabase
          .from('users')
          .select('full_name')
          .eq('id', userId)
          .single()
          .then(({ data: userData }) => {
            setOperatorName(userData?.full_name ?? data.user?.email ?? '');
          });
      }
    });
  }, [operatorId, loadId]);

  const { data: scans = [] } = usePickupScans(manifestId, operatorId);
  const { data: missingPackages = [] } = useMissingPackages(
    operatorId,
    loadId,
    manifestId
  );

  const verifiedCount = useMemo(
    () => scans.filter((s) => s.scan_result === 'verified').length,
    [scans]
  );

  const precision = useMemo(() => {
    const total = verifiedCount + missingPackages.length;
    return total > 0 ? Math.round((verifiedCount / total) * 100) : 0;
  }, [verifiedCount, missingPackages.length]);

  const elapsed = useMemo(() => {
    if (!manifestStartedAt) return '\u2014';
    const diff = Math.floor(
      (Date.now() - new Date(manifestStartedAt).getTime()) / 1000
    );
    const mins = Math.floor(diff / 60);
    const secs = diff % 60;
    return `${mins}m ${secs}s`;
  }, [manifestStartedAt]);

  const canComplete = !!operatorSignature;

  const handleComplete = async () => {
    if (!manifestId || !operatorId || !operatorSignature) return;
    setIsSubmitting(true);

    try {
      const supabase = createSPAClient();
      const { error } = await supabase
        .from('manifests')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          signature_operator: operatorSignature,
          signature_operator_name: operatorName,
          signature_client: clientSignature,
          signature_client_name: clientName || null,
        })
        .eq('id', manifestId);

      if (error) throw error;
      router.push('/app/pickup');
    } catch (err) {
      console.error('Failed to complete manifest:', err);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 p-4 max-w-2xl mx-auto">
      <PickupStepBreadcrumb current="complete" />

      {/* Gold header */}
      <div className="bg-accent text-accent-foreground dark:bg-accent-muted dark:text-accent p-4 -mx-4 rounded-none">
        <p className="text-xs opacity-80">{loadId}</p>
        <p className="font-semibold text-base mt-0.5">Complete Pickup</p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-surface border border-border rounded-lg p-3 flex items-center gap-2">
          <CheckCircle className="h-5 w-5 text-status-success shrink-0" />
          <div>
            <p className="text-xl font-bold font-mono text-text">{verifiedCount}</p>
            <p className="text-xs text-text-secondary">Verified</p>
          </div>
        </div>
        <div className="bg-surface border border-border rounded-lg p-3 flex items-center gap-2">
          <XCircle className="h-5 w-5 text-status-error shrink-0" />
          <div>
            <p className="text-xl font-bold font-mono text-text">{missingPackages.length}</p>
            <p className="text-xs text-text-secondary">Missing (noted)</p>
          </div>
        </div>
        <div className="bg-surface border border-border rounded-lg p-3 flex items-center gap-2">
          <Target className="h-5 w-5 text-status-info shrink-0" />
          <div>
            <p className="text-xl font-bold font-mono text-text">{precision}%</p>
            <p className="text-xs text-text-secondary">Precision</p>
          </div>
        </div>
        <div className="bg-surface border border-border rounded-lg p-3 flex items-center gap-2">
          <Shield className="h-5 w-5 text-text-secondary shrink-0" />
          <div>
            <p className="text-xl font-bold font-mono text-text">{elapsed}</p>
            <p className="text-xs text-text-secondary">Elapsed</p>
          </div>
        </div>
      </div>

      {/* Legal Notice */}
      <div className="bg-status-warning-bg border border-status-warning-border rounded-lg p-3">
        <p className="text-sm text-text font-medium">
          Custody Transfer Notice
        </p>
        <p className="text-xs text-text-secondary mt-1">
          By signing below, the operator confirms receipt of the verified
          packages. From this moment, the operator assumes legal responsibility
          for the goods.
        </p>
      </div>

      {/* Operator Signature (required) */}
      <div className="space-y-2">
        <p className="text-sm text-text-secondary">
          Operator: <strong className="text-text">{operatorName}</strong>
        </p>
        <SignaturePad
          label="Operator Signature (required)"
          onChange={setOperatorSignature}
        />
      </div>

      {/* Client Signature (optional) */}
      <div className="space-y-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={showClientSig}
            onChange={(e) => setShowClientSig(e.target.checked)}
            className="rounded"
          />
          <span className="text-sm text-text">Add client signature</span>
        </label>
        {showClientSig && (
          <div className="space-y-2 ml-6">
            <Input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Client name"
              className="text-sm"
              aria-label="Client name"
            />
            <SignaturePad
              label="Client Signature (optional)"
              onChange={setClientSignature}
            />
          </div>
        )}
      </div>

      {/* Complete Button */}
      <Button
        onClick={handleComplete}
        disabled={!canComplete || isSubmitting}
        className="w-full disabled:opacity-50"
        size="lg"
      >
        {isSubmitting ? 'Completing...' : 'Complete & Generate Receipt'}
      </Button>
    </div>
  );
}
