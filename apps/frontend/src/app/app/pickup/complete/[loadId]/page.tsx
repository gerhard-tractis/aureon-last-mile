'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SignaturePad } from '@/components/pickup/SignaturePad';
import { usePickupScans } from '@/hooks/pickup/usePickupScans';
import { useMissingPackages } from '@/hooks/pickup/useDiscrepancies';
import { useOperatorId } from '@/hooks/useOperatorId';
import { createSPAClient } from '@/lib/supabase/client';
import { CheckCircle, XCircle, Target, Shield } from 'lucide-react';

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
      <h1 className="text-xl font-bold text-foreground">
        Complete Pickup: {loadId}
      </h1>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
            <div>
              <p className="text-xl font-bold">{verifiedCount}</p>
              <p className="text-xs text-muted-foreground">Verified</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <XCircle className="h-5 w-5 text-red-500" />
            <div>
              <p className="text-xl font-bold">{missingPackages.length}</p>
              <p className="text-xs text-muted-foreground">Missing (noted)</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <Target className="h-5 w-5 text-blue-500" />
            <div>
              <p className="text-xl font-bold">{precision}%</p>
              <p className="text-xs text-muted-foreground">Precision</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <Shield className="h-5 w-5 text-purple-500" />
            <div>
              <p className="text-xl font-bold">{elapsed}</p>
              <p className="text-xs text-muted-foreground">Time Elapsed</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Legal Notice */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <p className="text-sm text-amber-800 font-medium">
          Custody Transfer Notice
        </p>
        <p className="text-xs text-amber-700 mt-1">
          By signing below, the operator confirms receipt of the verified
          packages. From this moment, the operator assumes legal responsibility
          for the goods.
        </p>
      </div>

      {/* Operator Signature (required) */}
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Operator: <strong>{operatorName}</strong>
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
          <span className="text-sm text-foreground">Add client signature</span>
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
        className="w-full bg-primary-600 hover:bg-primary-700 text-white disabled:opacity-50"
        size="lg"
      >
        {isSubmitting ? 'Completing...' : 'Complete & Generate Receipt'}
      </Button>
    </div>
  );
}
