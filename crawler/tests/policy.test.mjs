import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalizeUrl,
  isAllowlistedUrl,
  isHttpUrl,
  violatesKeywordPolicy
} from '../lib/policy.mjs';

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

test('http/https validation works', () => {
  assert.equal(isHttpUrl('https://example.com'), true);
  assert.equal(isHttpUrl('http://example.com'), true);
  assert.equal(isHttpUrl('ftp://example.com/file'), false);
  assert.equal(isHttpUrl('notaurl'), false);
});

test('canonicalize removes hash and default port', () => {
  assert.equal(
    canonicalizeUrl('https://example.com:443/path?q=1#frag'),
    'https://example.com/path?q=1'
  );
});
