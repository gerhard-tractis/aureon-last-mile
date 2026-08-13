import { requireModuleEnabled } from '@/lib/modules/require-enabled';
import { ModuleKey } from '@/lib/modules/registry';
import { createSSRClient } from '@/lib/supabase/server';
import { PrintPackageLabels } from './PrintPackageLabels';
import type { ManifestLabelRow } from '@/lib/pickup/manifest-label-types';

interface PageProps {
  params: Promise<{ manifestId: string }>;
  searchParams: Promise<{ packageId?: string }>;
}

// spec-53 — server component. Riding under PICKUP's layout guard is not
// enough: PACKAGE_LABELS is a separate, independently toggleable module (see
// registry.ts), so it needs its own gate here.
export default async function PrintPackageLabelsPage({ params, searchParams }: PageProps) {
  await requireModuleEnabled(ModuleKey.PACKAGE_LABELS);

  const { manifestId } = await params;
  const { packageId } = await searchParams;

  const supabase = await createSSRClient();
  const { data, error } = await (supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: ManifestLabelRow[] | null; error: { message: string } | null }>)(
    'get_manifest_label_data',
    { p_manifest_id: manifestId, p_package_id: packageId ?? null },
  );

  if (error) {
    throw new Error(`get_manifest_label_data failed: ${error.message}`);
  }

  return <PrintPackageLabels manifestId={manifestId} labels={data ?? []} />;
}
