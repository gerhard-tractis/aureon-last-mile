import { describe, it, expect, vi } from 'vitest';
import {
  validateColumns,
  validateRow,
  validateAllRows,
  findDuplicates,
  checkDatabaseDuplicates,
  normalizeDeliveryDate,
  normalizePhoneNumber,
  REQUIRED_COLUMNS,
} from '@/lib/validation/orderImportValidation';

const validRow: Record<string, string> = {
  order_number: 'ORD001',
  customer_name: 'John Doe',
  customer_phone: '912345678',
  delivery_address: 'Av. Libertador 123',
  comuna: 'Santiago',
  delivery_date: '2026-02-20',
};

describe('validateColumns', () => {
  it('should return empty array when all required columns present', () => {
    const fields = ['order_number', 'customer_name', 'customer_phone', 'delivery_address', 'comuna', 'delivery_date'];
    expect(validateColumns(fields)).toEqual([]);
  });

  it('should return missing columns', () => {
    const fields = ['order_number', 'customer_name'];
    const missing = validateColumns(fields);
    expect(missing).toContain('customer_phone');
    expect(missing).toContain('delivery_address');
    expect(missing).toContain('comuna');
    expect(missing).toContain('delivery_date');
    expect(missing).toHaveLength(4);
  });

  it('should handle case-insensitive column matching', () => {
    const fields = ['ORDER_NUMBER', 'Customer_Name', 'CUSTOMER_PHONE', 'delivery_address', 'Comuna', 'Delivery_Date'];
    expect(validateColumns(fields)).toEqual([]);
  });

  it('should return all required columns when fields are empty', () => {
    expect(validateColumns([])).toEqual([...REQUIRED_COLUMNS]);
  });
});

describe('validateRow', () => {
  it('should accept valid row with no errors', () => {
    const errors = validateRow(validRow, 2);
    expect(errors).toHaveLength(0);
  });

  it('should reject missing order_number', () => {
    const row = { ...validRow, order_number: '' };
    const errors = validateRow(row, 2);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('order_number');
    expect(errors[0].message).toBe('Order number is required');
  });

  it('should reject missing customer_name', () => {
    const row = { ...validRow, customer_name: '' };
    const errors = validateRow(row, 2);
    expect(errors.find((e) => e.field === 'customer_name')).toBeDefined();
  });

  it('should reject invalid phone format (not 9 digits)', () => {
    const row = { ...validRow, customer_phone: '1234' };
    const errors = validateRow(row, 2);
    expect(errors.find((e) => e.field === 'customer_phone')).toBeDefined();
    expect(errors.find((e) => e.field === 'customer_phone')?.message).toBe('Phone must be 9 digits');
  });

  it('should accept phone with +56 prefix', () => {
    const row = { ...validRow, customer_phone: '+56912345678' };
    const errors = validateRow(row, 2);
    expect(errors.find((e) => e.field === 'customer_phone')).toBeUndefined();
  });

  it('should accept phone with 56 prefix (no plus)', () => {
    const row = { ...validRow, customer_phone: '56912345678' };
    const errors = validateRow(row, 2);
    expect(errors.find((e) => e.field === 'customer_phone')).toBeUndefined();
  });

  it('should reject missing delivery_address', () => {
    const row = { ...validRow, delivery_address: '' };
    const errors = validateRow(row, 2);
    expect(errors.find((e) => e.field === 'delivery_address')).toBeDefined();
  });

  it('should reject invalid comuna', () => {
    const row = { ...validRow, comuna: 'InvalidCity' };
    const errors = validateRow(row, 2);
    expect(errors.find((e) => e.field === 'comuna')).toBeDefined();
    expect(errors.find((e) => e.field === 'comuna')?.message).toBe('Must be valid Chilean comuna');
  });

  it('should accept valid comuna (case insensitive)', () => {
    const row = { ...validRow, comuna: 'santiago' };
    const errors = validateRow(row, 2);
    expect(errors.find((e) => e.field === 'comuna')).toBeUndefined();
  });

  it('should reject empty comuna', () => {
    const row = { ...validRow, comuna: '' };
    const errors = validateRow(row, 2);
    expect(errors.find((e) => e.field === 'comuna')?.message).toBe('Comuna is required');
  });

  it('should accept ISO date format (YYYY-MM-DD)', () => {
    const row = { ...validRow, delivery_date: '2026-02-20' };
    const errors = validateRow(row, 2);
    expect(errors.find((e) => e.field === 'delivery_date')).toBeUndefined();
  });

  it('should accept DD/MM/YYYY date format', () => {
    const row = { ...validRow, delivery_date: '20/02/2026' };
    const errors = validateRow(row, 2);
    expect(errors.find((e) => e.field === 'delivery_date')).toBeUndefined();
  });

  it('should reject invalid date format', () => {
    const row = { ...validRow, delivery_date: 'invalid-date' };
    const errors = validateRow(row, 2);
    expect(errors.find((e) => e.field === 'delivery_date')).toBeDefined();
    expect(errors.find((e) => e.field === 'delivery_date')?.message).toBe('Date must be YYYY-MM-DD or DD/MM/YYYY');
  });

  it('should reject invalid date values (e.g., month 13)', () => {
    const row = { ...validRow, delivery_date: '2026-13-01' };
    const errors = validateRow(row, 2);
    expect(errors.find((e) => e.field === 'delivery_date')).toBeDefined();
  });

  it('should validate optional delivery_window_start (HH:MM)', () => {
    const row = { ...validRow, delivery_window_start: '09:00' };
    const errors = validateRow(row, 2);
    expect(errors).toHaveLength(0);
  });

  it('should reject invalid delivery_window_start', () => {
    const row = { ...validRow, delivery_window_start: 'invalid' };
    const errors = validateRow(row, 2);
    expect(errors.find((e) => e.field === 'delivery_window_start')).toBeDefined();
  });

  it('should skip validation for empty optional fields', () => {
    const row = { ...validRow, delivery_window_start: '', delivery_window_end: '' };
    const errors = validateRow(row, 2);
    expect(errors).toHaveLength(0);
  });

  it('should collect multiple errors from same row', () => {
    const row = { order_number: '', customer_name: '', customer_phone: '1234', delivery_address: '', comuna: '', delivery_date: '' };
    const errors = validateRow(row, 2);
    expect(errors.length).toBeGreaterThanOrEqual(6);
  });

  it('should include correct row index in errors', () => {
    const row = { ...validRow, order_number: '' };
    const errors = validateRow(row, 5);
    expect(errors[0].row).toBe(5);
  });
});

describe('validateAllRows', () => {
  it('should validate all rows and aggregate errors', () => {
    const data = [
      validRow,
      { ...validRow, order_number: '', customer_phone: '1234' },
    ];
    const errors = validateAllRows(data);
    // First row valid, second row has 2 errors
    expect(errors.length).toBe(2);
    // Row indices should be 2 (first data row) and 3 (second data row)
    expect(errors.every((e) => e.row === 3)).toBe(true);
  });

  it('should return empty array for all valid rows', () => {
    const data = [validRow, { ...validRow, order_number: 'ORD002' }];
    const errors = validateAllRows(data);
    expect(errors).toHaveLength(0);
  });
});

describe('findDuplicates', () => {
  it('should detect duplicate order numbers', () => {
    const data = [
      { order_number: 'ORD001' },
      { order_number: 'ORD002' },
      { order_number: 'ORD001' },
    ];
    const duplicates = findDuplicates(data as Record<string, string>[]);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].value).toBe('ORD001');
    expect(duplicates[0].message).toContain('Duplicate');
    expect(duplicates[0].message).toContain('row 2'); // first seen on row 2
    expect(duplicates[0].row).toBe(4); // third row = index 2 + 2 = row 4
  });

  it('should return empty for unique order numbers', () => {
    const data = [
      { order_number: 'ORD001' },
      { order_number: 'ORD002' },
      { order_number: 'ORD003' },
    ];
    const duplicates = findDuplicates(data as Record<string, string>[]);
    expect(duplicates).toHaveLength(0);
  });

  it('should skip rows without order_number', () => {
    const data = [
      { order_number: '' },
      { order_number: '' },
    ];
    const duplicates = findDuplicates(data as Record<string, string>[]);
    expect(duplicates).toHaveLength(0);
  });

  it('should detect multiple duplicate groups', () => {
    const data = [
      { order_number: 'ORD001' },
      { order_number: 'ORD002' },
      { order_number: 'ORD001' },
      { order_number: 'ORD002' },
    ];
    const duplicates = findDuplicates(data as Record<string, string>[]);
    expect(duplicates).toHaveLength(2);
  });
});

describe('checkDatabaseDuplicates', () => {
  it('should return duplicate order numbers found in database', async () => {
    const mockClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({
            data: [{ order_number: 'ORD001' }],
            error: null,
          }),
        }),
      }),
    };

    const result = await checkDatabaseDuplicates(['ORD001', 'ORD002'], mockClient);
    expect(result).toEqual(['ORD001']);
  });

  it('should return empty array on error', async () => {
    const mockClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({
            data: null,
            error: new Error('DB error'),
          }),
        }),
      }),
    };

    const result = await checkDatabaseDuplicates(['ORD001'], mockClient);
    expect(result).toEqual([]);
  });

  it('should return empty array for empty input', async () => {
    const mockClient = {
      from: vi.fn(),
    };

    const result = await checkDatabaseDuplicates([], mockClient as any);
    expect(result).toEqual([]);
    expect(mockClient.from).not.toHaveBeenCalled();
  });
});

describe('normalizeDeliveryDate', () => {
  it('should pass through ISO format', () => {
    expect(normalizeDeliveryDate('2026-02-20')).toBe('2026-02-20');
  });

  it('should convert DD/MM/YYYY to YYYY-MM-DD', () => {
    expect(normalizeDeliveryDate('20/02/2026')).toBe('2026-02-20');
  });

  it('should trim whitespace', () => {
    expect(normalizeDeliveryDate('  2026-02-20  ')).toBe('2026-02-20');
  });
});

describe('normalizePhoneNumber', () => {
  it('should return 9-digit phone as-is', () => {
    expect(normalizePhoneNumber('912345678')).toBe('912345678');
  });

  it('should strip +56 prefix', () => {
    expect(normalizePhoneNumber('+56912345678')).toBe('912345678');
  });

  it('should strip 56 prefix', () => {
    expect(normalizePhoneNumber('56912345678')).toBe('912345678');
  });

  it('should return original for invalid phone', () => {
    expect(normalizePhoneNumber('1234')).toBe('1234');
  });
});
