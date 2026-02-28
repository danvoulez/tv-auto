import test from 'node:test';
import assert from 'node:assert/strict';

import { isAllowlistedUrl, violatesKeywordPolicy } from '../lib/policy.mjs';

test('allowlist supports exact and subdomains', () => {
  assert.equal(isAllowlistedUrl('https://example.com/a', ['example.com']), true);
  assert.equal(isAllowlistedUrl('https://media.example.com/a', ['example.com']), true);
  assert.equal(isAllowlistedUrl('https://evil-example.com/a', ['example.com']), false);
});

test('keyword policy blocks blocked and blacklist words', () => {
  assert.deepEqual(violatesKeywordPolicy('cool stream', [], []), { blocked: false, reason: 'ok' });
  assert.equal(violatesKeywordPolicy('kids stream', [], ['kids']).blocked, true);
  assert.equal(violatesKeywordPolicy('leak footage', ['leak'], []).blocked, true);
});
