/**
 * Order import validation module.
 * CANONICAL validation for ALL data ingestion paths in Epic 2.
 * Reused by Stories 2.3 (Email), 2.4 (Manual Entry).
 */

import { isValidComuna } from '@/lib/data/chileanLocations';

export interface ValidationError {
  row: number;
  field: string;
  value: string | undefined;
  message: string;
}

export interface ValidationResult {
  validRows: Record<string, string>[];
  errors: ValidationError[];
  duplicates: ValidationError[];
  dbDuplicates: string[];
}

export const REQUIRED_COLUMNS = [
  'order_number',
  'customer_name',
  'customer_phone',
  'delivery_address',
  'comuna',
  'delivery_date',
] as const;

export const OPTIONAL_COLUMNS = [
  'delivery_window_start',
  'delivery_window_end',
  'retailer_name',
  'notes',
] as const;

/**
 * Validate that all required columns are present in the parsed fields.
 * Returns array of missing column names.
 */
export function validateColumns(fields: string[]): string[] {
  const normalizedFields = fields.map((f) => f.toLowerCase().trim());
  return REQUIRED_COLUMNS.filter((col) => !normalizedFields.includes(col));
}

const DATE_REGEX_ISO = /^\d{4}-\d{2}-\d{2}$/;
const DATE_REGEX_DMY = /^\d{2}\/\d{2}\/\d{4}$/;
const TIME_REGEX = /^\d{2}:\d{2}$/;

/**
 * Parse a date string in YYYY-MM-DD or DD/MM/YYYY format.
 * Returns null if invalid.
 */
function parseDate(value: string): Date | null {
  if (DATE_REGEX_ISO.test(value)) {
    const d = new Date(value + 'T00:00:00');
    return isNaN(d.getTime()) ? null : d;
  }
  if (DATE_REGEX_DMY.test(value)) {
    const [day, month, year] = value.split('/').map(Number);
    const d = new Date(year, month - 1, day);
    if (d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) {
      return d;
    }
  }
  return null;
}

/**
 * Normalize a Chilean phone number.
 * Accepts: 912345678, +56912345678, 56912345678
 * Returns 9-digit number or null if invalid.
 */
function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 9) return digits;
  if (digits.length === 11 && digits.startsWith('56')) return digits.slice(2);
  if (digits.length === 12 && digits.startsWith('56')) return digits.slice(3);
  return null;
}

/**
 * Validate a single row of order data.
 * rowIndex is 1-based (matches spreadsheet row numbers, accounting for header).
 */
export function validateRow(
  row: Record<string, string>,
  rowIndex: number
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Order number (required, non-empty)
  if (!row.order_number?.trim()) {
    errors.push({
      row: rowIndex,
      field: 'order_number',
      value: row.order_number,
      message: 'Order number is required',
    });
  }

  // Customer name (required, non-empty)
  if (!row.customer_name?.trim()) {
    errors.push({
      row: rowIndex,
      field: 'customer_name',
      value: row.customer_name,
      message: 'Customer name is required',
    });
  }

  // Customer phone (9 digits, +56 prefix optional)
  const phone = row.customer_phone?.toString() || '';
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    errors.push({
      row: rowIndex,
      field: 'customer_phone',
      value: row.customer_phone,
      message: 'Phone must be 9 digits',
    });
  }

  // Delivery address (required, non-empty)
  if (!row.delivery_address?.trim()) {
    errors.push({
      row: rowIndex,
      field: 'delivery_address',
      value: row.delivery_address,
      message: 'Delivery address is required',
    });
  }

  // Comuna (required, valid Chilean comuna)
  if (!row.comuna?.trim()) {
    errors.push({
      row: rowIndex,
      field: 'comuna',
      value: row.comuna,
      message: 'Comuna is required',
    });
  } else if (!isValidComuna(row.comuna)) {
    errors.push({
      row: rowIndex,
      field: 'comuna',
      value: row.comuna,
      message: 'Must be valid Chilean comuna',
    });
  }

  // Delivery date (YYYY-MM-DD or DD/MM/YYYY)
  if (!row.delivery_date?.trim()) {
    errors.push({
      row: rowIndex,
      field: 'delivery_date',
      value: row.delivery_date,
      message: 'Delivery date is required',
    });
  } else if (!parseDate(row.delivery_date.trim())) {
    errors.push({
      row: rowIndex,
      field: 'delivery_date',
      value: row.delivery_date,
      message: 'Date must be YYYY-MM-DD or DD/MM/YYYY',
    });
  }

  // Optional: delivery_window_start (HH:MM)
  if (row.delivery_window_start?.trim() && !TIME_REGEX.test(row.delivery_window_start.trim())) {
    errors.push({
      row: rowIndex,
      field: 'delivery_window_start',
      value: row.delivery_window_start,
      message: 'Must be valid time (HH:MM)',
    });
  }

  // Optional: delivery_window_end (HH:MM)
  if (row.delivery_window_end?.trim() && !TIME_REGEX.test(row.delivery_window_end.trim())) {
    errors.push({
      row: rowIndex,
      field: 'delivery_window_end',
      value: row.delivery_window_end,
      message: 'Must be valid time (HH:MM)',
    });
  }

  return errors;
}

/**
 * Validate all rows and return errors.
 * Row indices are 1-based starting from 2 (row 1 = header).
 */
export function validateAllRows(data: Record<string, string>[]): ValidationError[] {
  const allErrors: ValidationError[] = [];
  data.forEach((row, index) => {
    const rowErrors = validateRow(row, index + 2); // +2: header row + 0-indexed
    allErrors.push(...rowErrors);
  });
  return allErrors;
}

/**
 * Detect duplicate order_number values within the file.
 */
export function findDuplicates(data: Record<string, string>[]): ValidationError[] {
  const seen = new Map<string, number>();
  const duplicates: ValidationError[] = [];

  data.forEach((row, index) => {
    const orderNumber = row.order_number?.trim();
    if (!orderNumber) return;

    if (seen.has(orderNumber)) {
      duplicates.push({
        row: index + 2,
        field: 'order_number',
        value: orderNumber,
        message: `Duplicate order number (first seen on row ${seen.get(orderNumber)})`,
      });
    } else {
      seen.set(orderNumber, index + 2);
    }
  });

  return duplicates;
}

/**
 * Check for duplicate order numbers already in database for this operator.
 * Uses Supabase client passed as parameter for testability.
 */
export async function checkDatabaseDuplicates(
  orderNumbers: string[],
  supabaseClient: {
    from: (table: string) => {
      select: (columns: string) => {
        in: (column: string, values: string[]) => Promise<{ data: { order_number: string }[] | null; error: unknown }>;
      };
    };
  }
): Promise<string[]> {
  if (orderNumbers.length === 0) return [];

  const { data, error } = await supabaseClient
    .from('orders')
    .select('order_number')
    .in('order_number', orderNumbers);

  if (error) {
    console.error('Database duplicate check error:', error);
    return [];
  }

  return (data || []).map((row) => row.order_number);
}

/**
 * Normalize a delivery date to ISO format (YYYY-MM-DD).
 */
export function normalizeDeliveryDate(value: string): string {
  const trimmed = value.trim();
  if (DATE_REGEX_ISO.test(trimmed)) return trimmed;
  if (DATE_REGEX_DMY.test(trimmed)) {
    const [day, month, year] = trimmed.split('/');
    return `${year}-${month}-${day}`;
  }
  return trimmed;
}

/**
 * Normalize phone to 9-digit format.
 */
export function normalizePhoneNumber(phone: string): string {
  return normalizePhone(phone) || phone;
}
