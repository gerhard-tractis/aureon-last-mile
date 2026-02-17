import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { getClientIpAddress, setSupabaseSessionIp } from '@/lib/utils/ipAddress';

// Type for audit log with joined users table (plural from Supabase join)
interface AuditLogExport {
  timestamp: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  changes_json: Record<string, unknown> | null;
  ip_address: string | null;
  users: {
    full_name: string;
    role: string;
    email: string;
  } | {
    full_name: string;
    role: string;
    email: string;
  }[];
}

/**
 * GET /api/audit-logs/export
 * Export audit logs as CSV
 *
 * Story 1.6: Set Up Audit Logging Infrastructure
 *
 * Access: Admin only
 * RLS: Auto-filters by operator_id = get_operator_id()
 *
 * Query Parameters: (same as GET /api/audit-logs, except no pagination)
 * - date_from: ISO date string (default: 7 days ago)
 * - date_to: ISO date string (default: now)
 * - user_id: UUID filter
 * - action: Action filter
 * - resource_type: Resource type filter
 * - resource_id: Resource ID filter
 * - search: Full-text search
 *
 * Returns: CSV file (max 10,000 logs)
 * Note: FIX #10 - Full streaming not implemented yet, but 10K limit prevents memory issues
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createSSRClient();

    // FIX #2: Capture IP address for audit logging
    const ipAddress = getClientIpAddress(request);
    await setSupabaseSessionIp(supabase, ipAddress);

    // Verify authentication
    const { data: { session }, error: authError } = await supabase.auth.getSession();

    if (authError || !session) {
      return NextResponse.json(
        { code: 'UNAUTHORIZED', message: 'Authentication required', timestamp: new Date().toISOString() },
        { status: 401 }
      );
    }

    // Check user role - admin only
    const userRole = session.user.app_metadata?.claims?.role;

    if (userRole !== 'admin') {
      return NextResponse.json(
        {
          code: 'FORBIDDEN',
          message: 'Only admin users can export audit logs',
          timestamp: new Date().toISOString()
        },
        { status: 403 }
      );
    }

    // Parse query parameters (same as GET /api/audit-logs)
    const searchParams = request.nextUrl.searchParams;

    // Date filters (default: last 7 days)
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const date_from = searchParams.get('date_from') || sevenDaysAgo.toISOString();
    const date_to = searchParams.get('date_to') || now.toISOString();
    const user_id = searchParams.get('user_id');
    const action = searchParams.get('action');
    const resource_type = searchParams.get('resource_type');
    const resource_id = searchParams.get('resource_id');
    const search = searchParams.get('search');

    // Max 10,000 logs per export (prevent timeout)
    const MAX_EXPORT_LOGS = 10000;

    // Build query
    let query = supabase
      .from('audit_logs')
      .select(`
        id,
        operator_id,
        user_id,
        action,
        resource_type,
        resource_id,
        changes_json,
        ip_address,
        timestamp,
        users:user_id (
          full_name,
          role,
          email
        )
      `)
      .gte('timestamp', date_from)
      .lte('timestamp', date_to)
      .order('timestamp', { ascending: false })
      .limit(MAX_EXPORT_LOGS);

    // Apply filters
    if (user_id) {
      query = query.eq('user_id', user_id);
    }

    if (action) {
      query = query.eq('action', action);
    }

    if (resource_type) {
      query = query.eq('resource_type', resource_type);
    }

    if (resource_id) {
      query = query.eq('resource_id', resource_id);
    }

    // Full-text search
    if (search) {
      query = query.or(`action.ilike.%${search}%,resource_id::text.ilike.%${search}%,changes_json::text.ilike.%${search}%`);
    }

    // Execute query
    const { data: auditLogs, error } = await query as { data: AuditLogExport[] | null; error: { message: string } | null };

    if (error) {
      console.error('Error fetching audit logs for export:', error);
      return NextResponse.json(
        {
          code: 'DATABASE_ERROR',
          message: 'Failed to fetch audit logs for export',
          details: error.message,
          timestamp: new Date().toISOString()
        },
        { status: 500 }
      );
    }

    if (!auditLogs || auditLogs.length === 0) {
      return NextResponse.json(
        {
          code: 'NO_DATA',
          message: 'No audit logs found for the specified filters',
          timestamp: new Date().toISOString()
        },
        { status: 404 }
      );
    }

    // Generate CSV
    const csvHeaders = [
      'Timestamp',
      'User Name',
      'User Email',
      'User Role',
      'Action',
      'Resource Type',
      'Resource ID',
      'IP Address',
      'Changes (JSON)'
    ];

    const csvRows = auditLogs.map((log) => {
      const user = Array.isArray(log.users) ? log.users[0] : log.users;
      return [
        log.timestamp,
        user?.full_name || 'Unknown',
        user?.email || 'Unknown',
        user?.role || 'Unknown',
        log.action,
        log.resource_type || '',
        log.resource_id || '',
        log.ip_address || '',
        log.changes_json ? JSON.stringify(log.changes_json) : ''
      ]
        .map(field => {
          // Escape CSV fields (wrap in quotes if contains comma, newline, or quote)
          const fieldStr = String(field);
          if (fieldStr.includes(',') || fieldStr.includes('\n') || fieldStr.includes('"')) {
            return `"${fieldStr.replace(/"/g, '""')}"`;
          }
          return fieldStr;
        })
        .join(',');
    });

    const csvContent = [csvHeaders.join(','), ...csvRows].join('\n');

    // Generate filename: audit_logs_{operator}_{date}.csv
    const operatorId = session.user.app_metadata?.claims?.operator_id || 'unknown';
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `audit_logs_${operatorId}_${dateStr}.csv`;

    // Return CSV file
    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store'
      }
    });
  } catch (error) {
    console.error('Unexpected error in GET /api/audit-logs/export:', error);
    return NextResponse.json(
      {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}
