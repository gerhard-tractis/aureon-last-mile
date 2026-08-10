import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    // Only the seed-qa harness has unit tests. The SQL files under
    // supabase/tests/ are psql scripts, run against the QA database rather
    // than by vitest.
    include: ['seed-qa/**/*.test.ts'],
  },
});
