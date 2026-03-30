// src/agents/intake/intake-agent.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processIntakeSubmission } from './intake-agent';
import type { IntakeJobData } from './intake-agent';

vi.mock('../../tools/ocr/extract-manifest');

import { extractManifest } from '../../tools/ocr/extract-manifest';
const mockExtractManifest = vi.mocked(extractManifest);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeJob(overrides: Partial<IntakeJobData> = {}): IntakeJobData {
  return { submission_id: 'sub-1', operator_id: 'op-1', ...overrides };
}

function makeSubmission(storagePaths: string[] = ['manifests/page1.jpg']) {
  return {
    raw_payload: { storage_paths: storagePaths },
    pickup_point_id: 'pp-1',
  };
}

function makeExtractionResult(overrides = {}) {
  return {
    delivery_date: '2026-03-29',
    orders: [
      {
        order_number: 'ORD-001',
        customer_name: 'Juan Pérez',
        customer_phone: '+56912345678',
        delivery_address: 'Av. Las Condes 123',
        comuna: 'Las Condes',
        packages: [
          {
            label: 'PKG-001',
            package_number: 'P1',
            declared_box_count: 1,
            sku_items: [],
            declared_weight_kg: 2.5,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function makeDb(options: {
  submissionData?: ReturnType<typeof makeSubmission> | null;
  submissionError?: { message: string } | null;
  downloadError?: { message: string } | null;
  existingOrder?: { id: string } | null;
  orderInsertError?: { message: string } | null;
} = {}) {
  const {
    submissionData = makeSubmission(),
    submissionError = null,
    downloadError = null,
    existingOrder = null,
    orderInsertError = null,
  } = options;

  // Supabase storage mock
  const storageMock = {
    from: vi.fn().mockReturnValue({
      download: vi.fn().mockResolvedValue(
        downloadError
          ? { data: null, error: downloadError }
          : { data: { arrayBuffer: async () => Buffer.from('img') }, error: null },
      ),
    }),
  };

  // Chain builders
  const updateChain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
  };
  // Make the last .eq() resolve to avoid unhandled promise rejections
  updateChain.eq.mockReturnValue(updateChain);

  const selectSingleChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: submissionData, error: submissionError }),
  };
  selectSingleChain.eq.mockReturnValue(selectSingleChain);

  const dedupChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: existingOrder, error: null }),
  };
  dedupChain.eq.mockReturnValue(dedupChain);

  const orderInsertChain = {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(
      orderInsertError
        ? { data: null, error: orderInsertError }
        : { data: { id: 'ord-new' }, error: null },
    ),
  };

  const packageInsertChain = {
    insert: vi.fn().mockResolvedValue({ error: null }),
  };

  let submissionCallCount = 0;

  const db = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'intake_submissions') {
        submissionCallCount++;
        // First call = update (mark parsing), second call = select (fetch), rest = update (final)
        if (submissionCallCount === 1) return updateChain;
        if (submissionCallCount === 2) return selectSingleChain;
        return updateChain;
      }
      if (table === 'orders') {
        // If dedup check returns existing, this is the dedup branch
        // We need to differentiate dedup select vs insert
        // We'll use a counter per orders call
        return {
          select: vi.fn().mockReturnValue(dedupChain),
          insert: vi.fn().mockReturnValue(orderInsertChain),
        };
      }
      if (table === 'packages') {
        return packageInsertChain;
      }
      return updateChain;
    }),
    storage: storageMock,
  };

  return db;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('processIntakeSubmission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('processes multi-image submission and creates orders + packages', async () => {
    const db = makeDb({ submissionData: makeSubmission(['manifests/p1.jpg', 'manifests/p2.jpg']) });
    mockExtractManifest.mockResolvedValueOnce(makeExtractionResult());

    const result = await processIntakeSubmission(db as never, 'api-key-123', makeJob());

    expect(result.ordersCreated).toBe(1);
    expect(result.status).toBe('parsed');
    // packages table was written
    expect(db.from).toHaveBeenCalledWith('packages');
    // extractManifest was called with 2 buffers
    expect(mockExtractManifest).toHaveBeenCalledWith('api-key-123', expect.arrayContaining([expect.any(Buffer)]));
    const buffers = mockExtractManifest.mock.calls[0][1];
    expect(buffers).toHaveLength(2);
  });

  it('marks submission needs_review when required fields are null', async () => {
    const db = makeDb();
    mockExtractManifest.mockResolvedValueOnce(
      makeExtractionResult({
        orders: [
          {
            order_number: 'ORD-002',
            customer_name: null,
            customer_phone: null,
            delivery_address: null,
            comuna: null,
            packages: [],
          },
        ],
      }),
    );

    const result = await processIntakeSubmission(db as never, 'api-key-123', makeJob());

    // ordersCreated = 0 because order was inserted but hasIncompleteOrders = true
    // and ordersCreated might be 0 if no packages — but insert still happened
    // The final status should be needs_review due to missing fields
    expect(result.status).toBe('needs_review');
  });

  it('skips duplicate order_numbers', async () => {
    const db = makeDb({ existingOrder: { id: 'existing-ord' } });
    mockExtractManifest.mockResolvedValueOnce(makeExtractionResult());

    const result = await processIntakeSubmission(db as never, 'api-key-123', makeJob());

    expect(result.ordersCreated).toBe(0);
    expect(result.status).toBe('needs_review');
    // packages should NOT be inserted
    expect(db.from).not.toHaveBeenCalledWith('packages');
  });

  it('marks submission needs_review on API failure (extractManifest throws)', async () => {
    const db = makeDb();
    mockExtractManifest.mockRejectedValueOnce(new Error('OpenRouter 500'));

    const result = await processIntakeSubmission(db as never, 'api-key-123', makeJob());

    expect(result.ordersCreated).toBe(0);
    expect(result.status).toBe('needs_review');
    // markNeedsReview should have updated intake_submissions
    expect(db.from).toHaveBeenCalledWith('intake_submissions');
  });

  it('marks submission needs_review on illegible manifest', async () => {
    const db = makeDb();
    mockExtractManifest.mockResolvedValueOnce({
      delivery_date: null,
      orders: [],
      error: 'ilegible',
    });

    const result = await processIntakeSubmission(db as never, 'api-key-123', makeJob());

    expect(result.ordersCreated).toBe(0);
    expect(result.status).toBe('needs_review');
  });

  it('marks needs_review when no storage paths exist', async () => {
    const db = makeDb({ submissionData: makeSubmission([]) });

    const result = await processIntakeSubmission(db as never, 'api-key-123', makeJob());

    expect(result.ordersCreated).toBe(0);
    expect(result.status).toBe('needs_review');
    // extractManifest should never be called
    expect(mockExtractManifest).not.toHaveBeenCalled();
  });

  it('marks needs_review when all image downloads fail', async () => {
    const db = makeDb({ downloadError: { message: 'Storage not found' } });
    // submission has paths but downloads fail
    const result = await processIntakeSubmission(db as never, 'api-key-123', makeJob());

    expect(result.ordersCreated).toBe(0);
    expect(result.status).toBe('needs_review');
    expect(mockExtractManifest).not.toHaveBeenCalled();
  });

  it('throws when submission is not found', async () => {
    const db = makeDb({
      submissionData: null,
      submissionError: { message: 'row not found' },
    });

    await expect(
      processIntakeSubmission(db as never, 'api-key-123', makeJob()),
    ).rejects.toThrow('Submission sub-1 not found');
  });
});
