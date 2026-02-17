import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// Simple in-memory rate limiter for user creation
// Production: Replace with Redis-based rate limiting
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // 10 users per minute per admin

function checkRateLimit(userId: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const userLimit = rateLimitMap.get(userId);

  if (!userLimit || now > userLimit.resetAt) {
    // First request or window expired - reset
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return { allowed: true };
  }

  if (userLimit.count >= RATE_LIMIT_MAX_REQUESTS) {
    // Rate limit exceeded
    const retryAfter = Math.ceil((userLimit.resetAt - now) / 1000);
    return { allowed: false, retryAfter };
  }

  // Increment count
  userLimit.count += 1;
  return { allowed: true };
}

// Validation schema for creating users
const createUserSchema = z.object({
  email: z.string().email('Invalid email format'),
  full_name: z.string().min(2, 'Name must be at least 2 characters'),
  role: z.enum(['pickup_crew', 'warehouse_staff', 'loading_crew', 'operations_manager', 'admin'] as const, {
    message: 'Invalid role'
  }),
  operator_id: z.string().uuid('Invalid operator ID')
});

/**
 * GET /api/users
 * Fetch all users for the authenticated user's operator
 *
 * Access: Authenticated users
 * RLS: Auto-filters by operator_id = get_operator_id()
 */
export async function GET(_request: NextRequest) {
  try {
    const supabase = await createSSRClient();

    // Verify authentication
    const { data: { session }, error: authError } = await supabase.auth.getSession();

    if (authError || !session) {
      return NextResponse.json(
        { code: 'UNAUTHORIZED', message: 'Authentication required', timestamp: new Date().toISOString() },
        { status: 401 }
      );
    }

    // RLS policy auto-filters: WHERE operator_id = get_operator_id() AND deleted_at IS NULL
    const { data: users, error } = await supabase
      .from('users')
      .select('id, email, full_name, role, operator_id, created_at, deleted_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching users:', error);
      return NextResponse.json(
        {
          code: 'DATABASE_ERROR',
          message: 'Failed to fetch users',
          details: error.message,
          timestamp: new Date().toISOString()
        },
        { status: 500 }
      );
    }

    return NextResponse.json(users, { status: 200 });
  } catch (error) {
    console.error('Unexpected error in GET /api/users:', error);
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

/**
 * POST /api/users
 * Create a new user with Supabase Auth
 *
 * Access: Admin or operations_manager only
 * RLS: Enforced via JWT claims validation
 *
 * Body: { email, full_name, role, operator_id }
 *
 * Flow:
 * 1. Validate JWT (role = admin or operations_manager)
 * 2. Validate request body
 * 3. Call supabase.auth.admin.createUser()
 * 4. Database trigger (handle_new_user) auto-creates public.users record
 * 5. Send password setup email via Supabase Auth
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createSSRClient();

    // Verify authentication
    const { data: { session }, error: authError } = await supabase.auth.getSession();

    if (authError || !session) {
      return NextResponse.json(
        { code: 'UNAUTHORIZED', message: 'Authentication required', timestamp: new Date().toISOString() },
        { status: 401 }
      );
    }

    // Check user role from JWT claims (Story 1.3 dependency)
    const userRole = session.user.app_metadata?.claims?.role;

    if (userRole !== 'admin' && userRole !== 'operations_manager') {
      return NextResponse.json(
        {
          code: 'FORBIDDEN',
          message: 'Only admin and operations_manager can create users',
          timestamp: new Date().toISOString()
        },
        { status: 403 }
      );
    }

    // Rate limiting: Prevent mass user creation
    const rateLimitCheck = checkRateLimit(session.user.id);
    if (!rateLimitCheck.allowed) {
      return NextResponse.json(
        {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Too many user creation requests. Please try again in ${rateLimitCheck.retryAfter} seconds.`,
          timestamp: new Date().toISOString()
        },
        {
          status: 429,
          headers: {
            'Retry-After': rateLimitCheck.retryAfter?.toString() || '60'
          }
        }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const validation = createUserSchema.safeParse(body);

    if (!validation.success) {
      const firstError = validation.error.issues[0];
      return NextResponse.json(
        {
          code: 'VALIDATION_ERROR',
          message: firstError.message,
          field: firstError.path.join('.'),
          timestamp: new Date().toISOString()
        },
        { status: 400 }
      );
    }

    const { email, full_name, role, operator_id } = validation.data;

    // Validate operator_id matches admin's operator (prevent cross-operator user creation)
    const adminOperatorId = session.user.app_metadata?.claims?.operator_id;
    if (operator_id !== adminOperatorId) {
      return NextResponse.json(
        {
          code: 'FORBIDDEN',
          message: 'Cannot create users for a different operator',
          field: 'operator_id',
          timestamp: new Date().toISOString()
        },
        { status: 403 }
      );
    }

    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .eq('operator_id', operator_id)
      .single();

    if (existingUser) {
      return NextResponse.json(
        {
          code: 'EMAIL_EXISTS',
          message: 'User with this email already exists',
          field: 'email',
          timestamp: new Date().toISOString()
        },
        { status: 409 }
      );
    }

    // Create user in Supabase Auth
    // NOTE: Using admin API requires service role key - ensure this is configured
    const { data: authUser, error: createError } = await supabase.auth.admin.createUser({
      email,
      email_confirm: false, // User will confirm via email link
      app_metadata: {
        operator_id,
        role
      },
      user_metadata: {
        full_name
      }
    });

    if (createError) {
      console.error('Error creating user in Supabase Auth:', createError);

      // Map Supabase errors to user-friendly messages
      if (createError.message.includes('already registered')) {
        return NextResponse.json(
          {
            code: 'EMAIL_EXISTS',
            message: 'User with this email already exists',
            field: 'email',
            timestamp: new Date().toISOString()
          },
          { status: 409 }
        );
      }

      return NextResponse.json(
        {
          code: 'AUTH_ERROR',
          message: 'Failed to create user',
          details: createError.message,
          timestamp: new Date().toISOString()
        },
        { status: 500 }
      );
    }

    // Database trigger (handle_new_user) auto-creates public.users record
    // Retry logic to handle race condition with trigger execution
    type UserRecord = { id: string; email: string; full_name: string; role: string; operator_id: string; created_at: string; deleted_at: string | null };
    let createdUser: UserRecord | null = null;
    let fetchError: unknown = null;
    const maxRetries = 3;
    const retryDelay = 100; // ms

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0) {
        // Wait before retry to allow trigger to complete
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
      }

      const result = await supabase
        .from('users')
        .select('id, email, full_name, role, operator_id, created_at, deleted_at')
        .eq('id', authUser.user.id)
        .single<UserRecord>();

      if (result.data) {
        createdUser = result.data;
        fetchError = null;
        break;
      }

      fetchError = result.error;
    }

    if (fetchError || !createdUser) {
      console.error('Error fetching created user after retries:', fetchError);
      // User was created in auth.users but public.users fetch failed even after retries
      return NextResponse.json(
        {
          code: 'PARTIAL_SUCCESS',
          message: 'User created but could not fetch details. Please refresh the page.',
          user_id: authUser.user.id,
          timestamp: new Date().toISOString()
        },
        { status: 201 }
      );
    }

    return NextResponse.json(createdUser, { status: 201 });
  } catch (error) {
    console.error('Unexpected error in POST /api/users:', error);
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
