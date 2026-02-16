import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// Validation schema for updating users
const updateUserSchema = z.object({
  full_name: z.string().min(2, 'Name must be at least 2 characters').optional(),
  role: z.enum(['pickup_crew', 'warehouse_staff', 'loading_crew', 'operations_manager', 'admin'], {
    errorMap: () => ({ message: 'Invalid role' })
  }).optional()
}).refine(
  (data) => data.full_name !== undefined || data.role !== undefined,
  { message: 'At least one field (full_name or role) must be provided' }
);

/**
 * PUT /api/users/[id]
 * Update user's full_name and/or role
 *
 * Access: Admin or operations_manager only
 * RLS: Can only update users from own operator
 *
 * Body: { full_name?, role? }
 *
 * NOTE: Email and operator_id cannot be changed via this endpoint
 * NOTE: JWT claims won't auto-update - user must re-authenticate
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    // Check user role from JWT claims
    const userRole = session.user.app_metadata?.claims?.role;

    if (userRole !== 'admin' && userRole !== 'operations_manager') {
      return NextResponse.json(
        {
          code: 'FORBIDDEN',
          message: 'Only admin and operations_manager can update users',
          timestamp: new Date().toISOString()
        },
        { status: 403 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const validation = updateUserSchema.safeParse(body);

    if (!validation.success) {
      const firstError = validation.error.errors[0];
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

    const { id } = params;
    const updateData = validation.data;

    // Check if user exists and belongs to the same operator (RLS will enforce this)
    const { data: existingUser, error: fetchError } = await supabase
      .from('users')
      .select('id, role, operator_id')
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (fetchError || !existingUser) {
      return NextResponse.json(
        {
          code: 'NOT_FOUND',
          message: 'User not found or access denied',
          timestamp: new Date().toISOString()
        },
        { status: 404 }
      );
    }

    const roleChanged = updateData.role && updateData.role !== existingUser.role;

    // Prevent changing last admin's role to non-admin (would lock out operator)
    if (roleChanged && existingUser.role === 'admin' && updateData.role !== 'admin') {
      const { data: adminUsers, error: countError } = await supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin')
        .eq('operator_id', existingUser.operator_id)
        .is('deleted_at', null);

      if (!countError && adminUsers && (adminUsers as any).count <= 1) {
        return NextResponse.json(
          {
            code: 'LAST_ADMIN',
            message: 'Cannot change role: must have at least one admin',
            timestamp: new Date().toISOString()
          },
          { status: 403 }
        );
      }
    }

    // Update user in public.users table
    // RLS policy (users_admin_full_access) enforces: Can only update users from own operator
    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', id)
      .select('id, email, full_name, role, operator_id, created_at, deleted_at')
      .single();

    if (updateError) {
      console.error('Error updating user:', updateError);

      // RLS policy violation (attempting to update user from different operator)
      if (updateError.code === 'PGRST116') {
        return NextResponse.json(
          {
            code: 'FORBIDDEN',
            message: 'Cannot edit users from other operators',
            timestamp: new Date().toISOString()
          },
          { status: 403 }
        );
      }

      return NextResponse.json(
        {
          code: 'DATABASE_ERROR',
          message: 'Failed to update user',
          details: updateError.message,
          timestamp: new Date().toISOString()
        },
        { status: 500 }
      );
    }

    // Return updated user with roleChanged flag
    return NextResponse.json(
      {
        ...updatedUser,
        roleChanged
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Unexpected error in PUT /api/users/[id]:', error);
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
 * DELETE /api/users/[id]
 * Soft-delete user (sets deleted_at timestamp)
 *
 * Access: Admin only
 * RLS: Can only delete users from own operator
 *
 * NOTE: Soft delete means user cannot login (Custom Access Token Hook checks deleted_at)
 * NOTE: Can be reversed by setting deleted_at = NULL in database
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    // Check user role from JWT claims - ADMIN ONLY for delete
    const userRole = session.user.app_metadata?.claims?.role;

    if (userRole !== 'admin') {
      return NextResponse.json(
        {
          code: 'FORBIDDEN',
          message: 'Only admin can delete users',
          timestamp: new Date().toISOString()
        },
        { status: 403 }
      );
    }

    const { id } = params;

    // Check if user exists and belongs to the same operator
    const { data: existingUser, error: fetchError } = await supabase
      .from('users')
      .select('id, email, role, operator_id')
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (fetchError || !existingUser) {
      return NextResponse.json(
        {
          code: 'NOT_FOUND',
          message: 'User not found or already deleted',
          timestamp: new Date().toISOString()
        },
        { status: 404 }
      );
    }

    // Prevent deleting self
    if (id === session.user.id) {
      return NextResponse.json(
        {
          code: 'FORBIDDEN',
          message: 'Cannot delete your own account',
          timestamp: new Date().toISOString()
        },
        { status: 403 }
      );
    }

    // Optional: Check if this is the last admin (prevent locking out)
    if (existingUser.role === 'admin') {
      const { data: adminUsers, error: countError } = await supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin')
        .eq('operator_id', existingUser.operator_id)
        .is('deleted_at', null);

      if (!countError && adminUsers && (adminUsers as any).count <= 1) {
        return NextResponse.json(
          {
            code: 'LAST_ADMIN',
            message: 'Cannot delete the last admin user',
            timestamp: new Date().toISOString()
          },
          { status: 403 }
        );
      }
    }

    // Soft delete: UPDATE users SET deleted_at = NOW()
    // RLS policy enforces: Can only delete users from own operator
    const { error: deleteError } = await supabase
      .from('users')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);

    if (deleteError) {
      console.error('Error soft-deleting user:', deleteError);

      // RLS policy violation
      if (deleteError.code === 'PGRST116') {
        return NextResponse.json(
          {
            code: 'FORBIDDEN',
            message: 'Cannot delete users from other operators',
            timestamp: new Date().toISOString()
          },
          { status: 403 }
        );
      }

      return NextResponse.json(
        {
          code: 'DATABASE_ERROR',
          message: 'Failed to delete user',
          details: deleteError.message,
          timestamp: new Date().toISOString()
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { message: 'User deleted successfully', timestamp: new Date().toISOString() },
      { status: 200 }
    );
  } catch (error) {
    console.error('Unexpected error in DELETE /api/users/[id]:', error);
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
