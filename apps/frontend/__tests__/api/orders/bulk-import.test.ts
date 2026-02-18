import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must use vi.hoisted so the mock object is available when vi.mock factories run
const { mockSupabase, mockParseOrdersFile } = vi.hoisted(() => ({
  mockSupabase: {
    auth: {
      getSession: vi.fn(),
    },
    from: vi.fn(),
  },
  mockParseOrdersFile: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSSRClient: vi.fn().mockResolvedValue(mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: vi.fn().mockReturnValue([]),
    set: vi.fn(),
  }),
}));

vi.mock('@/lib/parsers/orderFileParser', () => ({
  parseOrdersFile: mockParseOrdersFile,
}));

// Mock NextRequest/NextResponse to avoid jsdom FormData issues
vi.mock('next/server', async () => {
  const actual = await vi.importActual('next/server');
  return {
    ...actual,
  };
});

import { POST } from '@/app/api/orders/bulk-import/route';

const validParsed = {
  data: [
    {
      order_number: 'ORD001',
      customer_name: 'John Doe',
      customer_phone: '912345678',
      delivery_address: 'Av. Libertador 123',
      comuna: 'Santiago',
      delivery_date: '2026-02-20',
    },
    {
      order_number: 'ORD002',
      customer_name: 'Jane Smith',
      customer_phone: '987654321',
      delivery_address: 'Calle Moneda 456',
      comuna: 'Providencia',
      delivery_date: '2026-02-21',
    },
  ],
  errors: [],
  meta: {
    fields: ['order_number', 'customer_name', 'customer_phone', 'delivery_address', 'comuna', 'delivery_date'],
    rowCount: 2,
  },
};

const invalidParsed = {
  data: [
    {
      order_number: 'ORD001',
      customer_name: 'John Doe',
      customer_phone: '1234',
      delivery_address: 'Av. Libertador 123',
      comuna: 'Santiago',
      delivery_date: '2026-02-20',
    },
    {
      order_number: '',
      customer_name: 'Jane Smith',
      customer_phone: '987654321',
      delivery_address: 'Calle Moneda 456',
      comuna: 'Providencia',
      delivery_date: 'invalid-date',
    },
  ],
  errors: [],
  meta: {
    fields: ['order_number', 'customer_name', 'customer_phone', 'delivery_address', 'comuna', 'delivery_date'],
    rowCount: 2,
  },
};

const missingColumnsParsed = {
  data: [{ order_number: 'ORD001', customer_name: 'John Doe' }],
  errors: [],
  meta: { fields: ['order_number', 'customer_name'], rowCount: 1 },
};

// Create a mock request that works reliably in jsdom
function createMockRequest(hasFile = true): any {
  const mockFile = hasFile ? { name: 'test.csv', size: 100, type: 'text/csv' } : null;
  return {
    formData: vi.fn().mockResolvedValue({
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'file') return mockFile;
        return null;
      }),
    }),
    headers: {
      get: vi.fn().mockReturnValue('127.0.0.1'),
    },
  };
}

function mockAuthSession(role = 'admin', operatorId = 'op-123') {
  mockSupabase.auth.getSession.mockResolvedValue({
    data: {
      session: {
        user: {
          id: 'user-123',
          app_metadata: {
            claims: { role, operator_id: operatorId },
          },
        },
      },
    },
    error: null,
  });
}

function mockOrdersTable(existingOrders: string[] = []) {
  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'orders') {
      return {
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({
            data: existingOrders.map((o) => ({ order_number: o })),
            error: null,
          }),
        }),
        insert: vi.fn().mockResolvedValue({ error: null }),
      };
    }
    if (table === 'audit_logs') {
      return { insert: vi.fn().mockResolvedValue({ error: null }) };
    }
    return { insert: vi.fn().mockResolvedValue({ error: null }) };
  });
}

describe('POST /api/orders/bulk-import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParseOrdersFile.mockResolvedValue(validParsed);
  });

  it('should return 401 when not authenticated', async () => {
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    const response = await POST(createMockRequest());
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.code).toBe('UNAUTHORIZED');
  });

  it('should return 403 for non-admin/operations_manager roles', async () => {
    mockAuthSession('pickup_crew');
    const response = await POST(createMockRequest());
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.code).toBe('FORBIDDEN');
  });

  it('should return 400 when no file provided', async () => {
    mockAuthSession();
    const response = await POST(createMockRequest(false));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 for unparseable file', async () => {
    mockAuthSession();
    mockParseOrdersFile.mockRejectedValue(new Error('File too large. Maximum 10MB.'));
    const response = await POST(createMockRequest());
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.message).toContain('File too large');
  });

  it('should return 422 for missing required columns', async () => {
    mockAuthSession();
    mockParseOrdersFile.mockResolvedValue(missingColumnsParsed);
    mockOrdersTable();
    const response = await POST(createMockRequest());
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.message).toContain('Missing required column');
  });

  it('should import valid CSV successfully', async () => {
    mockAuthSession();
    mockOrdersTable();
    const response = await POST(createMockRequest());
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.success).toBe(true);
    expect(data.imported).toBe(2);
    expect(data.errors).toBe(0);
  });

  it('should return validation errors for invalid data', async () => {
    mockAuthSession();
    mockParseOrdersFile.mockResolvedValue(invalidParsed);
    mockOrdersTable();
    const response = await POST(createMockRequest());
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.validation_errors.length).toBeGreaterThan(0);
  });

  it('should detect database duplicate orders', async () => {
    mockAuthSession();
    mockOrdersTable(['ORD001']);
    const response = await POST(createMockRequest());
    const data = await response.json();

    expect(response.status).toBe(201);
    const dbDuplicateErrors = data.validation_errors.filter(
      (e: { message: string }) => e.message.includes('already exists in database')
    );
    expect(dbDuplicateErrors.length).toBeGreaterThan(0);
  });

  it('should log to audit_logs on successful import', async () => {
    mockAuthSession();
    mockOrdersTable();
    await POST(createMockRequest());

    const auditCalls = mockSupabase.from.mock.calls.filter(
      (call: string[]) => call[0] === 'audit_logs'
    );
    expect(auditCalls.length).toBeGreaterThan(0);
  });

  it('should accept operations_manager role', async () => {
    mockAuthSession('operations_manager');
    mockOrdersTable();
    const response = await POST(createMockRequest());

    expect(response.status).toBe(201);
  });
});
