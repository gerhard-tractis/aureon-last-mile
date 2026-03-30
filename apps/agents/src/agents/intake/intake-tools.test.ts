import { describe, it } from 'vitest';

describe('intake-tools (legacy)', () => {
  it('module exports empty (agent uses direct orchestration now)', () => {
    // intake-tools.ts is a legacy stub.
    // The INTAKE agent was rewritten in spec-23 to use processIntakeSubmission
    // with direct extractManifest calls instead of tool-calling loop.
  });
});
