/**
 * Authentication and Authorization Type Definitions
 * Story 1.3: Role-Based Access Control (RBAC)
 *
 * These types define the 5-role RBAC system for Aureon Last Mile platform.
 * They match the database ENUM user_role and JWT custom claims structure.
 */

/**
 * User Role ENUM - Maps to database ENUM type: user_role
 *
 * Role hierarchy (implicit):
 * admin > operations_manager > (loading_crew / warehouse_staff / pickup_crew)
 */
export enum UserRole {
  /** Pickup drivers - scan manifests, confirm pickups (Epic 4) */
  PICKUP_CREW = 'pickup_crew',

  /** Warehouse workers - receive shipments, sort packages (Epic 4) */
  WAREHOUSE_STAFF = 'warehouse_staff',

  /** Loading dock workers - load trucks, confirm dispatch (Epic 5) */
  LOADING_CREW = 'loading_crew',

  /** Operations oversight - view dashboards, manage users (Epic 3) */
  OPERATIONS_MANAGER = 'operations_manager',

  /** System administrator - full access, configure settings (Epic 1) */
  ADMIN = 'admin',
}

/**
 * Type guard to check if a string is a valid UserRole
 */
export function isValidUserRole(role: string): role is UserRole {
  return Object.values(UserRole).includes(role as UserRole);
}

/**
 * Custom JWT Claims added by Supabase Auth Hook
 *
 * These claims are added to the JWT access token by the custom_access_token_hook
 * PostgreSQL function registered in Supabase Dashboard (Authentication > Hooks).
 *
 * Access via: session?.user?.app_metadata?.claims
 */
export interface CustomClaims {
  /** Tenant identifier (operator UUID) for multi-tenant isolation */
  operator_id: string; // UUID string

  /** User's role from users table */
  role: UserRole;
}

/**
 * User Profile from public.users table
 *
 * This matches the users table schema created in Story 1.3 migration.
 * Type-safe representation of database row.
 */
export interface UserProfile {
  /** User ID (matches auth.users.id) */
  id: string; // UUID

  /** Operator ID (tenant identifier) */
  operator_id: string; // UUID

  /** User's role (ENUM) */
  role: UserRole;

  /** User's email (synced from auth.users) */
  email: string;

  /** User's full name */
  full_name: string;

  /** Account creation timestamp */
  created_at: string; // ISO 8601 timestamp

  /** Soft delete timestamp (null = active user) */
  deleted_at: string | null; // ISO 8601 timestamp or null
}

/**
 * Extended Supabase User type with custom claims
 *
 * Augments the default Supabase User type to include our custom JWT claims.
 * Use this when working with authenticated user sessions.
 */
export interface AuthenticatedUser {
  /** User ID from auth.users */
  id: string;

  /** User email */
  email?: string;

  /** Custom JWT claims (operator_id, role) */
  app_metadata?: {
    claims?: CustomClaims;
  };
}

/**
 * Role-based permission helpers
 *
 * These functions define the permission hierarchy for the RBAC system.
 * Use in frontend route guards and conditional UI rendering.
 */
export const RolePermissions = {
  /**
   * Check if role can manage users (assign roles, create/delete users)
   */
  canManageUsers(role: UserRole): boolean {
    return role === UserRole.ADMIN || role === UserRole.OPERATIONS_MANAGER;
  },

  /**
   * Check if role can view analytics dashboards
   */
  canViewDashboards(role: UserRole): boolean {
    return (
      role === UserRole.ADMIN ||
      role === UserRole.OPERATIONS_MANAGER
    );
  },

  /**
   * Check if role can access admin settings
   */
  canAccessAdminSettings(role: UserRole): boolean {
    return role === UserRole.ADMIN;
  },

  /**
   * Check if role can perform pickup operations
   */
  canPerformPickups(role: UserRole): boolean {
    return (
      role === UserRole.PICKUP_CREW ||
      role === UserRole.ADMIN ||
      role === UserRole.OPERATIONS_MANAGER
    );
  },

  /**
   * Check if role can perform warehouse operations
   */
  canPerformWarehouseOps(role: UserRole): boolean {
    return (
      role === UserRole.WAREHOUSE_STAFF ||
      role === UserRole.ADMIN ||
      role === UserRole.OPERATIONS_MANAGER
    );
  },

  /**
   * Check if role can perform loading operations
   */
  canPerformLoadingOps(role: UserRole): boolean {
    return (
      role === UserRole.LOADING_CREW ||
      role === UserRole.ADMIN ||
      role === UserRole.OPERATIONS_MANAGER
    );
  },

  /**
   * Get human-readable role name
   */
  getRoleDisplayName(role: UserRole): string {
    const roleNames: Record<UserRole, string> = {
      [UserRole.PICKUP_CREW]: 'Pickup Crew',
      [UserRole.WAREHOUSE_STAFF]: 'Warehouse Staff',
      [UserRole.LOADING_CREW]: 'Loading Crew',
      [UserRole.OPERATIONS_MANAGER]: 'Operations Manager',
      [UserRole.ADMIN]: 'Administrator',
    };
    return roleNames[role];
  },
} as const;

/**
 * Signup metadata structure
 *
 * Use when calling supabase.auth.signUp() to provide operator and role info.
 * This data is stored in auth.users.raw_app_meta_data and used by the trigger.
 */
export interface SignupMetadata {
  /** Operator UUID (REQUIRED - signup fails without this) */
  operator_id: string;

  /** User role (defaults to pickup_crew if not provided) */
  role?: UserRole;

  /** User's full name (defaults to email if not provided) */
  full_name?: string;
}

/**
 * Example usage:
 *
 * ```typescript
 * import { UserRole, CustomClaims, SignupMetadata, RolePermissions } from '@/lib/types/auth.types';
 *
 * // Sign up a new user
 * const signupData: SignupMetadata = {
 *   operator_id: '00000000-0000-0000-0000-000000000001',
 *   role: UserRole.PICKUP_CREW,
 *   full_name: 'John Doe'
 * };
 *
 * const { data, error } = await supabase.auth.signUp({
 *   email: 'john@example.com',
 *   password: 'password123',
 *   options: { data: signupData }
 * });
 *
 * // Access custom claims from session
 * const { data: { session } } = await supabase.auth.getSession();
 * const claims: CustomClaims | undefined = session?.user?.app_metadata?.claims;
 *
 * if (claims) {
 *   console.log('Operator ID:', claims.operator_id);
 *   console.log('Role:', claims.role);
 *
 *   // Check permissions
 *   if (RolePermissions.canManageUsers(claims.role)) {
 *     // Show user management UI
 *   }
 * }
 * ```
 */
