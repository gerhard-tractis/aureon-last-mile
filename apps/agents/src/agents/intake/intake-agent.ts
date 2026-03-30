// src/agents/intake/intake-agent.ts — INTAKE agent: multi-photo manifest → OCR → orders
import type { SupabaseClient } from '@supabase/supabase-js';
import { extractManifest, type ExtractionResult } from '../../tools/ocr/extract-manifest';
import { log } from '../../lib/logger';

export interface IntakeJobData {
  submission_id: string;
  operator_id: string;
}

const REQUIRED_ORDER_FIELDS = ['customer_name', 'customer_phone', 'delivery_address', 'comuna'] as const;

export async function processIntakeSubmission(
  db: SupabaseClient,
  openrouterApiKey: string,
  job: IntakeJobData,
): Promise<{ ordersCreated: number; status: 'parsed' | 'needs_review' }> {
  const { submission_id, operator_id } = job;

  // 1. Mark as parsing
  await db
    .from('intake_submissions')
    .update({ status: 'parsing', processing_started_at: new Date().toISOString() })
    .eq('id', submission_id)
    .eq('operator_id', operator_id);

  // 2. Read submission to get storage paths
  const { data: submission, error: fetchErr } = await db
    .from('intake_submissions')
    .select('raw_payload, pickup_point_id')
    .eq('id', submission_id)
    .eq('operator_id', operator_id)
    .single();

  if (fetchErr || !submission) {
    throw new Error(`Submission ${submission_id} not found: ${fetchErr?.message}`);
  }

  const storagePaths: string[] = submission.raw_payload?.storage_paths ?? [];
  const pickupPointId: string | null = submission.pickup_point_id;

  if (storagePaths.length === 0) {
    await markNeedsReview(db, submission_id, operator_id, 'No storage paths in submission');
    return { ordersCreated: 0, status: 'needs_review' };
  }

  // 3. Download all images
  const imageBuffers: Buffer[] = [];
  for (const path of storagePaths) {
    const { data, error } = await db.storage.from('manifests').download(path);
    if (error) {
      log('warn', 'image_download_failed', { submission_id, path, error: error.message });
      continue;
    }
    const arrayBuf = await data.arrayBuffer();
    imageBuffers.push(Buffer.from(arrayBuf));
  }

  if (imageBuffers.length === 0) {
    await markNeedsReview(db, submission_id, operator_id, 'All image downloads failed');
    return { ordersCreated: 0, status: 'needs_review' };
  }

  // 4. Call OpenRouter vision OCR
  let extraction: ExtractionResult;
  try {
    extraction = await extractManifest(openrouterApiKey, imageBuffers);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log('error', 'ocr_extraction_failed', { submission_id, error: msg });
    await markNeedsReview(db, submission_id, operator_id, `OCR failed: ${msg}`);
    return { ordersCreated: 0, status: 'needs_review' };
  }

  // 5. Handle illegible manifest
  if (extraction.error) {
    await markNeedsReview(db, submission_id, operator_id, extraction.error);
    return { ordersCreated: 0, status: 'needs_review' };
  }

  // 6. Insert orders + packages
  const deliveryDate = extraction.delivery_date ?? new Date().toISOString().slice(0, 10);
  let ordersCreated = 0;
  let hasIncompleteOrders = false;

  for (const order of extraction.orders) {
    const missingFields = REQUIRED_ORDER_FIELDS.filter((f) => !order[f]);
    if (missingFields.length > 0) hasIncompleteOrders = true;

    // Dedup check
    const { data: existing } = await db
      .from('orders')
      .select('id')
      .eq('operator_id', operator_id)
      .eq('order_number', order.order_number)
      .maybeSingle();

    if (existing) {
      log('info', 'order_duplicate_skipped', { submission_id, order_number: order.order_number });
      continue;
    }

    // Insert order
    const { data: newOrder, error: orderErr } = await db
      .from('orders')
      .insert({
        operator_id,
        order_number: order.order_number,
        customer_name: order.customer_name ?? '',
        customer_phone: order.customer_phone ?? '',
        delivery_address: order.delivery_address ?? '',
        comuna: order.comuna ?? '',
        delivery_date: deliveryDate,
        pickup_point_id: pickupPointId,
        imported_via: 'OCR',
        imported_at: new Date().toISOString(),
        raw_data: order,
        metadata: missingFields.length > 0 ? { needs_review: true, missing_fields: missingFields } : {},
      })
      .select('id')
      .single();

    if (orderErr) {
      log('warn', 'order_insert_failed', {
        submission_id, order_number: order.order_number, error: orderErr.message,
      });
      continue;
    }

    // Insert packages
    for (const pkg of order.packages) {
      await db.from('packages').insert({
        operator_id,
        order_id: newOrder.id,
        label: pkg.label,
        package_number: pkg.package_number,
        declared_box_count: pkg.declared_box_count,
        sku_items: pkg.sku_items,
        declared_weight_kg: pkg.declared_weight_kg,
        raw_data: pkg,
      });
    }

    ordersCreated++;
  }

  // 7. Update submission
  const finalStatus = hasIncompleteOrders || ordersCreated === 0 ? 'needs_review' : 'parsed';
  await db
    .from('intake_submissions')
    .update({
      status: finalStatus,
      orders_created: ordersCreated,
      parsed_data: extraction,
      processed_by_agent: 'INTAKE',
      processing_completed_at: new Date().toISOString(),
    })
    .eq('id', submission_id)
    .eq('operator_id', operator_id);

  log('info', 'intake_complete', { submission_id, ordersCreated, status: finalStatus });
  return { ordersCreated, status: finalStatus };
}

async function markNeedsReview(
  db: SupabaseClient,
  submissionId: string,
  operatorId: string,
  reason: string,
): Promise<void> {
  await db
    .from('intake_submissions')
    .update({
      status: 'needs_review',
      validation_errors: [{ message: reason }],
      processed_by_agent: 'INTAKE',
      processing_completed_at: new Date().toISOString(),
    })
    .eq('id', submissionId)
    .eq('operator_id', operatorId);
}
