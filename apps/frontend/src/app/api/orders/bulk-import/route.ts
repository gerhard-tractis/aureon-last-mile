import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import {
  validateColumns,
  validateAllRows,
  findDuplicates,
  normalizeDeliveryDate,
  normalizePhoneNumber,
  ValidationError,
} from '@/lib/validation/orderImportValidation';
import { parseOrdersFile } from '@/lib/parsers/orderFileParser';

// Rate limiting
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX = 100;

function checkRateLimit(userId: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();

  // Sweep expired entries every 100 calls to prevent unbounded growth
  if (rateLimitMap.size > 100) {
    for (const [key, val] of rateLimitMap) {
      if (now > val.resetAt) rateLimitMap.delete(key);
    }
  }

  const entry = rateLimitMap.get(userId);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return { allowed: true };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }

  entry.count += 1;
  return { allowed: true };
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSSRClient();

    // Auth check
    const {
      data: { session },
      error: authError,
    } = await supabase.auth.getSession();

    if (authError || !session) {
      return NextResponse.json(
        { code: 'UNAUTHORIZED', message: 'Authentication required', timestamp: new Date().toISOString() },
        { status: 401 }
      );
    }

    // Role check
    const userRole = session.user.app_metadata?.claims?.role;
    if (userRole !== 'admin' && userRole !== 'operations_manager') {
      return NextResponse.json(
        { code: 'FORBIDDEN', message: 'Insufficient permissions', timestamp: new Date().toISOString() },
        { status: 403 }
      );
    }

    // Rate limit
    const rateCheck = checkRateLimit(session.user.id);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Too many requests. Try again in ${rateCheck.retryAfter} seconds.`,
          timestamp: new Date().toISOString(),
        },
        { status: 429, headers: { 'Retry-After': String(rateCheck.retryAfter || 60) } }
      );
    }

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: 'No file provided', timestamp: new Date().toISOString() },
        { status: 400 }
      );
    }

    // Server-side file validation + parsing
    let parsed;
    try {
      parsed = await parseOrdersFile(file);
    } catch (err) {
      return NextResponse.json(
        {
          code: 'VALIDATION_ERROR',
          message: err instanceof Error ? err.message : 'Failed to parse file',
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }

    // Column validation
    const missingColumns = validateColumns(parsed.meta.fields);
    if (missingColumns.length > 0) {
      return NextResponse.json(
        {
          code: 'VALIDATION_ERROR',
          message: `Missing required column: ${missingColumns.join(', ')}`,
          timestamp: new Date().toISOString(),
        },
        { status: 422 }
      );
    }

    // Row validation
    const rowErrors = validateAllRows(parsed.data);
    const duplicates = findDuplicates(parsed.data);
    const allErrors: ValidationError[] = [...rowErrors, ...duplicates];

    // Check database duplicates
    const orderNumbers = parsed.data
      .map((r) => r.order_number?.trim())
      .filter(Boolean);

    const operatorId = session.user.app_metadata?.claims?.operator_id as string | undefined;
    let dbDuplicates: string[] = [];

    if (orderNumbers.length > 0 && operatorId) {
      const { data: existing } = await supabase
        .from('orders')
        .select('order_number')
        .in('order_number', orderNumbers);

      dbDuplicates = (existing || []).map((r: { order_number: string }) => r.order_number);

      dbDuplicates.forEach((orderNum) => {
        const rowIdx = parsed.data.findIndex((r) => r.order_number?.trim() === orderNum);
        if (rowIdx >= 0) {
          allErrors.push({
            row: rowIdx + 2,
            field: 'order_number',
            value: orderNum,
            message: 'Order number already exists in database',
          });
        }
      });
    }

    // Determine valid rows (rows with no errors)
    const errorRows = new Set(allErrors.map((e) => e.row));
    const validRows = parsed.data.filter((_, i) => !errorRows.has(i + 2));

    if (!operatorId) {
      return NextResponse.json(
        { code: 'FORBIDDEN', message: 'No operator assigned to user', timestamp: new Date().toISOString() },
        { status: 403 }
      );
    }

    if (validRows.length === 0) {
      return NextResponse.json(
        {
          success: true,
          imported: 0,
          errors: allErrors.length,
          validation_errors: allErrors,
        },
        { status: 201 }
      );
    }

    // Batch insert valid orders
    const userId = session.user.id;
    const now = new Date().toISOString();

    const ordersToInsert = validRows.map((row) => ({
      operator_id: operatorId,
      order_number: row.order_number.trim(),
      customer_name: row.customer_name.trim(),
      customer_phone: normalizePhoneNumber(row.customer_phone || ''),
      delivery_address: row.delivery_address.trim(),
      comuna: row.comuna.trim(),
      delivery_date: normalizeDeliveryDate(row.delivery_date),
      delivery_window_start: row.delivery_window_start?.trim() || null,
      delivery_window_end: row.delivery_window_end?.trim() || null,
      retailer_name: row.retailer_name?.trim() || (formData.get('retailer_name') as string) || null,
      raw_data: row,
      metadata: {},
      imported_via: 'CSV' as const,
      imported_at: now,
    }));

    const { error: insertError } = await supabase
      .from('orders')
      // @ts-expect-error -- createServerClient third generic causes .insert() to resolve as never
      .insert(ordersToInsert);

    if (insertError) {
      console.error('Bulk import insert error:', insertError);
      return NextResponse.json(
        {
          code: 'DATABASE_ERROR',
          message: 'Failed to import orders',
          details: insertError.message,
          timestamp: new Date().toISOString(),
        },
        { status: 500 }
      );
    }

    // Audit log
    // @ts-expect-error -- createServerClient third generic causes .insert() to resolve as never
    await supabase.from('audit_logs').insert({
      operator_id: operatorId,
      user_id: userId,
      action: 'CSV_IMPORT',
      resource_type: 'order',
      changes_json: {
        file_name: file.name,
        rows_imported: validRows.length,
        rows_failed: allErrors.length,
      },
      ip_address: request.headers.get('x-forwarded-for') ?? 'unknown',
    });

    return NextResponse.json(
      {
        success: true,
        imported: validRows.length,
        errors: allErrors.length,
        validation_errors: allErrors,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Unexpected error in POST /api/orders/bulk-import:', error);
    return NextResponse.json(
      {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
