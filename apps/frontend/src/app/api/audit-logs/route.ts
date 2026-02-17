import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { getClientIpAddress, setSupabaseSessionIp } from '@/lib/utils/ipAddress';

/**
 * GET /api/audit-logs
 * Fetch audit logs with filters
 *
 * Story 1.6: Set Up Audit Logging Infrastructure
 *
 * Access: Admin only
 * RLS: Auto-filters by operator_id = get_operator_id()
 *
 * Query Parameters:
 * - date_from: ISO date string (default: 7 days ago)
 * - date_to: ISO date string (default: now)
 * - user_id: UUID filter
 * - action: Action filter (e.g., 'INSERT_users')
 * - resource_type: Resource type filter (e.g., 'users')
 * - resource_id: Resource ID filter (UUID)
 * - search: Full-text search in resource_id, action, changes_json
 * - page: Page number (default: 1)
 * - limit: Results per page (default: 50, max: 100)
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
          message: 'Only admin users can access audit logs',
          timestamp: new Date().toISOString()
        },
        { status: 403 }
      );
    }

    // Parse query parameters
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
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);

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
      `, { count: 'exact' })
      .gte('timestamp', date_from)
      .lte('timestamp', date_to)
      .order('timestamp', { ascending: false });

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

    // Full-text search (searches action, resource_id as text, and changes_json)
    if (search) {
      query = query.or(`action.ilike.%${search}%,resource_id::text.ilike.%${search}%,changes_json::text.ilike.%${search}%`);
    }

    // Pagination
    const start = (page - 1) * limit;
    query = query.range(start, start + limit - 1);

    // Execute query
    const { data: auditLogs, error, count } = await query;

    if (error) {
      console.error('Error fetching audit logs:', error);
      return NextResponse.json(
        {
          code: 'DATABASE_ERROR',
          message: 'Failed to fetch audit logs',
          details: error.message,
          timestamp: new Date().toISOString()
        },
        { status: 500 }
      );
    }

    // Transform data: flatten joined user data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transformedLogs = (auditLogs as any[])?.map((log: any) => ({
      ...log,
      user: Array.isArray(log.users) ? log.users[0] : log.users,
      users: undefined // Remove raw joined data
    })) || [];

    return NextResponse.json({
      data: transformedLogs,
      total: count || 0,
      page,
      limit
    }, { status: 200 });
  } catch (error) {
    console.error('Unexpected error in GET /api/audit-logs:', error);
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
