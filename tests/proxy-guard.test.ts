/**
 * Tests for proxy environment variable guard (M-06).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getSetProxyEnvVars, assertNoProxyConfigured, checkProxyAtRequestTime } from '../src/proxy-guard.js';

// ─── Helpers ──────────────────────────────────────────────────────────────

const SAVED_ENV: Record<string, string | undefined> = {};

function saveEnv(vars: string[]) {
  for (const v of vars) {
    SAVED_ENV[v] = process.env[v];
  }
}

function restoreEnv(vars: string[]) {
  for (const v of vars) {
    if (SAVED_ENV[v] === undefined) {
      delete process.env[v];
    } else {
      process.env[v] = SAVED_ENV[v];
    }
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('proxy-guard (M-06)', () => {
  const PROXY_VARS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY',
    'http_proxy', 'https_proxy', 'all_proxy',
    'GLOBAL_AGENT_HTTP_PROXY', 'GLOBAL_AGENT_HTTPS_PROXY'];

  beforeEach(() => {
    saveEnv(PROXY_VARS);
    // Clear all proxy vars before each test
    for (const v of PROXY_VARS) {
      delete process.env[v];
    }
  });

  afterEach(() => {
    restoreEnv(PROXY_VARS);
  });

  it('returns empty array when no proxy vars set', () => {
    const result = getSetProxyEnvVars();
    assert.deepEqual(result, []);
  });

  it('detects HTTP_PROXY', () => {
    process.env.HTTP_PROXY = 'http://proxy.local:8080';
    const result = getSetProxyEnvVars();
    assert.ok(result.includes('HTTP_PROXY'));
  });

  it('detects HTTPS_PROXY', () => {
    process.env.HTTPS_PROXY = 'https://proxy.local:8443';
    const result = getSetProxyEnvVars();
    assert.ok(result.includes('HTTPS_PROXY'));
  });

  it('detects ALL_PROXY', () => {
    process.env.ALL_PROXY = 'socks://proxy.local:1080';
    const result = getSetProxyEnvVars();
    assert.ok(result.includes('ALL_PROXY'));
  });

  it('detects lowercase http_proxy', () => {
    process.env.http_proxy = 'http://proxy.local:8080';
    const result = getSetProxyEnvVars();
    assert.ok(result.includes('http_proxy'));
  });

  it('ignores empty proxy vars', () => {
    process.env.HTTP_PROXY = '';
    const result = getSetProxyEnvVars();
    assert.deepEqual(result, []);
  });

  it('assertNoProxyConfigured passes when no proxy', () => {
    // Should not throw
    assertNoProxyConfigured();
  });

  it('assertNoProxyConfigured throws when proxy set', () => {
    process.env.HTTP_PROXY = 'http://proxy.local:8080';
    assert.throws(
      () => assertNoProxyConfigured(),
      /Proxy environment variable detected/,
    );
  });

  it('checkProxyAtRequestTime passes when no proxy', () => {
    checkProxyAtRequestTime();
  });

  it('checkProxyAtRequestTime throws when proxy set at request time', () => {
    process.env.HTTPS_PROXY = 'https://proxy.local:8443';
    assert.throws(
      () => checkProxyAtRequestTime(),
      /Proxy config detected at request time/,
    );
  });
});
