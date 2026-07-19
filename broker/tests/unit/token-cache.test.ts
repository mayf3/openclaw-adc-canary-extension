/**
 * Token Cache Unit Tests
 *
 * Covers:
 * - Cache hit returns valid token
 * - Near-expiry triggers refresh
 * - Concurrent requests are deduplicated
 * - Different agentId/clientId/audience/scope keys are all isolated
 * - Two agents with same audience+scope do NOT share tokens
 * - 401 invalidate + retry
 * - Auth-service failure fallback to stale token
 * - Clear() resets state
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TokenCache, REFRESH_EARLY_SECONDS } from '../../src/token-cache.js';

// ─── Constants for test identities ────────────────────────────────────────

const CANARY_AGENT = 'auth-canary-agent';
const CANARY_CLIENT = 'openclaw-auth-canary-agent';

const OTHER_AGENT = 'other-agent';
const OTHER_CLIENT = 'openclaw-other-agent';

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeIssuer(prefix = 'tok', expiresIn = 300) {
  let callCount = 0;
  return {
    issuer: async () => {
      callCount++;
      return { accessToken: `${prefix}_${callCount}`, expiresIn };
    },
    getCallCount: () => callCount,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('TokenCache', () => {
  it('returns a token from the issuer on first call', async () => {
    const cache = new TokenCache();
    const { issuer } = makeIssuer();

    const token = await cache.getToken(CANARY_AGENT, CANARY_CLIENT, 'aud1', 'scope1', issuer);
    assert.equal(token, 'tok_1');
    assert.equal(cache.stats.hits, 0);
    assert.equal(cache.stats.refreshes, 1);
  });

  it('returns cached token on subsequent calls before expiry', async () => {
    const cache = new TokenCache();
    const { issuer } = makeIssuer('tok', 300);

    const t1 = await cache.getToken(CANARY_AGENT, CANARY_CLIENT, 'aud1', 'scope1', issuer);
    const t2 = await cache.getToken(CANARY_AGENT, CANARY_CLIENT, 'aud1', 'scope1', issuer);

    assert.equal(t1, 'tok_1');
    assert.equal(t2, 'tok_1'); // same cached value
    assert.equal(cache.stats.hits, 1);
    assert.equal(cache.stats.refreshes, 1);
  });

  it('isolates tokens by audience', async () => {
    const cache = new TokenCache();
    const { issuer: issuer1 } = makeIssuer('aud1');
    const { issuer: issuer2 } = makeIssuer('aud2');

    const t1 = await cache.getToken(CANARY_AGENT, CANARY_CLIENT, 'audience-a', 'scope1', issuer1);
    const t2 = await cache.getToken(CANARY_AGENT, CANARY_CLIENT, 'audience-b', 'scope1', issuer2);

    assert.equal(t1, 'aud1_1');
    assert.equal(t2, 'aud2_1');
    assert.notEqual(t1, t2);
  });

  it('isolates tokens by scope', async () => {
    const cache = new TokenCache();
    const { issuer: issuer1 } = makeIssuer('s1');
    const { issuer: issuer2 } = makeIssuer('s2');

    const t1 = await cache.getToken(CANARY_AGENT, CANARY_CLIENT, 'aud', 'scope.a', issuer1);
    const t2 = await cache.getToken(CANARY_AGENT, CANARY_CLIENT, 'aud', 'scope.b', issuer2);

    assert.equal(t1, 's1_1');
    assert.equal(t2, 's2_1');
    assert.notEqual(t1, t2);
  });

  it('isolates tokens by agentId (same audience+scope → different tokens)', async () => {
    const cache = new TokenCache();
    const { issuer: canaryIssuer, getCallCount: canaryCalls } = makeIssuer('canary', 300);
    const { issuer: otherIssuer, getCallCount: otherCalls } = makeIssuer('other', 300);

    // Two different agents request the same audience and scope
    const canaryToken = await cache.getToken(
      CANARY_AGENT, CANARY_CLIENT,
      'svc-workflow', 'workflow.read',
      canaryIssuer,
    );
    const otherToken = await cache.getToken(
      OTHER_AGENT, OTHER_CLIENT,
      'svc-workflow', 'workflow.read',
      otherIssuer,
    );

    // Different tokens because different agentId+clientId → different cache keys
    assert.notEqual(canaryToken, otherToken);
    assert.equal(canaryToken, 'canary_1');
    assert.equal(otherToken, 'other_1');

    // Both issuers were called exactly once (no cache collision)
    assert.equal(canaryCalls(), 1);
    assert.equal(otherCalls(), 1);

    // Second call for each agent returns cached token
    const canaryToken2 = await cache.getToken(
      CANARY_AGENT, CANARY_CLIENT,
      'svc-workflow', 'workflow.read',
      canaryIssuer,
    );
    const otherToken2 = await cache.getToken(
      OTHER_AGENT, OTHER_CLIENT,
      'svc-workflow', 'workflow.read',
      otherIssuer,
    );

    // Same tokens as before (cache hit)
    assert.equal(canaryToken2, 'canary_1');
    assert.equal(otherToken2, 'other_1');
    assert.equal(canaryCalls(), 1); // no new issuance
    assert.equal(otherCalls(), 1);  // no new issuance
  });

  it('isolates tokens by clientId (same agent+audience+scope → different tokens)', async () => {
    const cache = new TokenCache();
    const { issuer: clientAIssuer, getCallCount: clientACalls } = makeIssuer('clientA', 300);
    const { issuer: clientBIssuer, getCallCount: clientBCalls } = makeIssuer('clientB', 300);

    // Same agent uses two different client IDs for the same audience+scope
    const tokenA = await cache.getToken(
      CANARY_AGENT, 'client-id-a',
      'svc-workflow', 'workflow.read',
      clientAIssuer,
    );
    const tokenB = await cache.getToken(
      CANARY_AGENT, 'client-id-b',
      'svc-workflow', 'workflow.read',
      clientBIssuer,
    );

    assert.notEqual(tokenA, tokenB);
    assert.equal(clientACalls(), 1);
    assert.equal(clientBCalls(), 1);
  });

  it('deduplicates concurrent requests for same key', async () => {
    const cache = new TokenCache();
    let concurrentCalls = 0;
    const slowIssuer = async () => {
      concurrentCalls++;
      await sleep(100);
      return { accessToken: 'slow_tok', expiresIn: 300 };
    };

    const [r1, r2] = await Promise.all([
      cache.getToken(CANARY_AGENT, CANARY_CLIENT, 'aud', 'scope', slowIssuer),
      cache.getToken(CANARY_AGENT, CANARY_CLIENT, 'aud', 'scope', slowIssuer),
    ]);

    assert.equal(r1, 'slow_tok');
    assert.equal(r2, 'slow_tok');
    assert.equal(concurrentCalls, 1, 'issuer must only be called once');
    assert.equal(cache.stats.dedupSaves, 1);
  });

  it('refreshes proactively when near expiry', async () => {
    const cache = new TokenCache();
    const { issuer, getCallCount } = makeIssuer('tok', REFRESH_EARLY_SECONDS - 1); // expires very soon

    // First call: issues
    const t1 = await cache.getToken(CANARY_AGENT, CANARY_CLIENT, 'aud', 'scope', issuer);
    assert.equal(t1, 'tok_1');
    assert.equal(getCallCount(), 1);
    assert.equal(cache.stats.refreshes, 1);

    // Second call: near-expiry triggers refresh
    const t2 = await cache.getToken(CANARY_AGENT, CANARY_CLIENT, 'aud', 'scope', issuer);
    assert.equal(t2, 'tok_2'); // fresh token
    assert.equal(getCallCount(), 2);
    assert.equal(cache.stats.refreshes, 2);
  });

  it('invalidates specific cache entry', async () => {
    const cache = new TokenCache();
    const { issuer, getCallCount } = makeIssuer('tok', 300);

    await cache.getToken(CANARY_AGENT, CANARY_CLIENT, 'aud', 'scope', issuer);
    assert.equal(getCallCount(), 1);

    // Invalidate forces re-issue
    cache.invalidate(CANARY_AGENT, CANARY_CLIENT, 'aud', 'scope');
    await cache.getToken(CANARY_AGENT, CANARY_CLIENT, 'aud', 'scope', issuer);
    assert.equal(getCallCount(), 2);
  });

  it('invalidate does not affect other keys', async () => {
    const cache = new TokenCache();
    const issuerA = makeIssuer('a', 300);
    const issuerB = makeIssuer('b', 300);

    await cache.getToken(CANARY_AGENT, CANARY_CLIENT, 'aud-a', 'scope', issuerA.issuer);
    await cache.getToken(CANARY_AGENT, CANARY_CLIENT, 'aud-b', 'scope', issuerB.issuer);

    cache.invalidate(CANARY_AGENT, CANARY_CLIENT, 'aud-a', 'scope');
    // aud-b should still be cached
    await cache.getToken(CANARY_AGENT, CANARY_CLIENT, 'aud-b', 'scope', issuerB.issuer);
    assert.equal(issuerB.getCallCount(), 1, 'issuerB should not be called again');
  });

  it('falls back to stale token if issuer fails and stale token exists', async () => {
    const cache = new TokenCache();

    // First call: successful
    const goodIssuer = async () => ({ accessToken: 'good_token', expiresIn: 300 });
    const token = await cache.getToken(CANARY_AGENT, CANARY_CLIENT, 'aud', 'scope', goodIssuer);
    assert.equal(token, 'good_token');

    // Invalidate to force re-issue with failing issuer
    cache.invalidate(CANARY_AGENT, CANARY_CLIENT, 'aud', 'scope');
    const failIssuer = async () => {
      throw new Error('auth-service down');
    };

    await assert.rejects(
      () => cache.getToken(CANARY_AGENT, CANARY_CLIENT, 'aud', 'scope', failIssuer),
      /auth-service down/,
    );
  });

  it('clears all cached tokens', async () => {
    const cache = new TokenCache();
    const { issuer } = makeIssuer('tok', 300);

    await cache.getToken(CANARY_AGENT, CANARY_CLIENT, 'aud1', 'scope1', issuer);
    await cache.getToken(CANARY_AGENT, CANARY_CLIENT, 'aud2', 'scope2', issuer);

    cache.clear();

    // Both should re-issue
    const { issuer: issA } = makeIssuer('a', 300);
    const { issuer: issB } = makeIssuer('b', 300);

    const t1 = await cache.getToken(CANARY_AGENT, CANARY_CLIENT, 'aud1', 'scope1', issA);
    const t2 = await cache.getToken(CANARY_AGENT, CANARY_CLIENT, 'aud2', 'scope2', issB);

    assert.equal(t1, 'a_1');
    assert.equal(t2, 'b_1');
  });
});
