import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase client - must be declared before vi.mock due to hoisting
const mockSupabaseFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createSSRClient: vi.fn(() => ({
    from: mockSupabaseFrom,
  })),
}));

import { GET } from './route';

describe('/api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return healthy status when all checks pass', async () => {
    // Mock successful database query
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({
          data: [{ id: '1' }],
          error: null,
        }),
      }),
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('healthy');
    expect(data.checks.database).toBe(true);
    expect(data.checks.memory).toBe(true);
    expect(data.checks.timestamp).toBeDefined();
  });

  it('should return unhealthy status when database check fails', async () => {
    // Mock database error
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Connection failed' },
        }),
      }),
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.status).toBe('unhealthy');
    expect(data.checks.database).toBe(false);
  });

  it('should include memory usage in response', async () => {
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({
          data: [{ id: '1' }],
          error: null,
        }),
      }),
    });

    const response = await GET();
    const data = await response.json();

    expect(data.memory).toBeDefined();
    expect(data.memory.heapUsed).toBeDefined();
    expect(data.memory.heapTotal).toBeDefined();
    expect(typeof data.memory.heapUsed).toBe('string');
    expect(data.memory.heapUsed).toMatch(/\d+MB/);
  });

  it('should return unhealthy if memory usage exceeds 80%', async () => {
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({
          data: [{ id: '1' }],
          error: null,
        }),
      }),
    });

    // Mock high memory usage
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 100 * 1024 * 1024,
      heapTotal: 100 * 1024 * 1024,
      heapUsed: 85 * 1024 * 1024, // 85% usage
      external: 0,
      arrayBuffers: 0,
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.status).toBe('unhealthy');
    expect(data.checks.memory).toBe(false);

    vi.restoreAllMocks();
  });

  it('should handle exceptions gracefully', async () => {
    // Mock database throwing error
    mockSupabaseFrom.mockImplementation(() => {
      throw new Error('Database connection timeout');
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.status).toBe('unhealthy');
    expect(data.error).toBeDefined();
    expect(data.error).toContain('Database connection timeout');
  });

  it('should include timestamp in ISO format', async () => {
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({
          data: [{ id: '1' }],
          error: null,
        }),
      }),
    });

    const response = await GET();
    const data = await response.json();

    expect(data.checks.timestamp).toBeDefined();
    // Verify it's a valid ISO date string
    expect(new Date(data.checks.timestamp).toISOString()).toBe(data.checks.timestamp);
  });
});
