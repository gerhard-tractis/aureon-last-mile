/**
 * User Form Validation Schema
 * Zod schema for validating user creation and editing forms
 */

import { z } from 'zod';

/**
 * Available module permissions
 */
export const PERMISSION_VALUES = ['pickup', 'reception', 'distribution', 'dispatch', 'customer_service'] as const;
export type Permission = typeof PERMISSION_VALUES[number];

export const permissionOptions: { value: Permission; label: string }[] = [
  { value: 'pickup', label: 'Pickup' },
  { value: 'reception', label: 'Recepción' },
  { value: 'distribution', label: 'Distribución' },
  { value: 'dispatch', label: 'Despacho' },
  { value: 'customer_service', label: 'Conversaciones' },
];

/**
 * User creation schema
 * Used when creating a new user
 */
export const createUserSchema = z.object({
  email: z.string().email('Invalid email format'),
  full_name: z.string().min(2, 'Name must be at least 2 characters'),
  role: z.enum(
    ['pickup_crew', 'warehouse_staff', 'loading_crew', 'operations_manager', 'admin'] as const,
    { message: 'Please select a valid role' }
  ),
  permissions: z.array(z.enum(PERMISSION_VALUES)),
  operator_id: z.string().uuid('Invalid operator ID')
});

/**
 * User update schema
 * Used when editing an existing user
 * Email and operator_id cannot be changed
 */
export const updateUserSchema = z.object({
  full_name: z.string().min(2, 'Name must be at least 2 characters').optional(),
  role: z.enum(
    ['pickup_crew', 'warehouse_staff', 'loading_crew', 'operations_manager', 'admin'] as const,
    { message: 'Please select a valid role' }
  ).optional(),
  permissions: z.array(z.enum(PERMISSION_VALUES)).optional(),
}).refine(
  (data) => data.full_name !== undefined || data.role !== undefined || data.permissions !== undefined,
  { message: 'At least one field must be provided' }
);

/**
 * TypeScript types inferred from schemas
 */
export type CreateUserFormData = z.infer<typeof createUserSchema>;
export type UpdateUserFormData = z.infer<typeof updateUserSchema>;

/**
 * Role options for dropdown
 */
export const roleOptions = [
  { value: 'pickup_crew', label: 'Pickup Crew', color: 'gray' },
  { value: 'warehouse_staff', label: 'Warehouse Staff', color: 'gray' },
  { value: 'loading_crew', label: 'Loading Crew', color: 'gray' },
  { value: 'operations_manager', label: 'Operations Manager', color: 'blue' },
  { value: 'admin', label: 'Administrator', color: 'gold' }
] as const;

/**
 * Get role display name
 */
export const getRoleDisplayName = (role: string): string => {
  const option = roleOptions.find(opt => opt.value === role);
  return option?.label || role;
};

/**
 * Get role color
 */
export const getRoleColor = (role: string): 'gold' | 'blue' | 'gray' => {
  const option = roleOptions.find(opt => opt.value === role);
  return option?.color || 'gray';
};
