// TEMPORARY scaffold smoke test — exists so `npm run test` has a test file
// until the real test suites land. Safe to delete once those exist.
import { describe, expect, it } from 'vitest';

describe('scaffold smoke', () => {
  it('runs the test harness', () => {
    expect(1 + 1).toBe(2);
  });
});
