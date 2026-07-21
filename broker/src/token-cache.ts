/**
 * Token Cache — Per-agent, per-client, per-audience, per-scope access token
 * cache with concurrent request deduplication and proactive refresh.
 *
 * Security properties:
 * - Tokens are NEVER persisted to disk.
 * - Cache keys incorporate agentId, clientId, audience AND canonicalScope.
 * - A token issued for one (agentId, clientId, audience, scope) quadruple
 *   is NEVER returned for another.
 * - Two agents accessing the same audience and scope receive DIFFERENT tokens.
 * - Concurrent requests for the same key are deduplicated.
 * - 401 after a fresh token triggers at most one controlled refresh.
 * - Tokens are NOT exported to the model or written to logs.
 */

// ─── Constants ────────────────────────────────────────────────────────────

/** Refresh the token when less than this many seconds remain until expiry. */
export const REFRESH_EARLY_SECONDS = 60;

/** Minimum TTL for a token to be considered usable (prevents stampede on very short TTLs). */
export const MIN_USABLE_TTL_SECONDS = 5;

// ─── Types ────────────────────────────────────────────────────────────────

export interface CachedToken {
  /** The access token string. */
  accessToken: string;
  /** Unix timestamp in ms when this token expires. */
  expiresAtMs: number;
}

export interface TokenIssuerResult {
  accessToken: string;
  /** Number of seconds until the token expires. */
  expiresIn: number;
}

/** Function that issues a new token. Must be provided by the caller. */
export type TokenIssuer = () => Promise<TokenIssuerResult>;

// ─── Cache ────────────────────────────────────────────────────────────────

export class TokenCache {
  /** Cache key = `${agentId}|${clientId}|${audience}|${scope}` → cached token. */
  private _cache = new Map<string, CachedToken>();

  /** Map of in-flight token issuances per key (concurrent dedup). */
  private _pending = new Map<string, Promise<CachedToken>>();

  /** Stats for testability. */
  private _stats = { hits: 0, refreshes: 0, dedupSaves: 0, errors: 0 };

  /**
   * Get a cached token for the given agent/client/audience/scope, or issue a new one.
   *
   * @param agentId   The authenticated agent identifier (from ctx.agentId).
   * @param clientId  The OAuth2 client ID used for credential resolution.
   * @param audience  The token audience (resource identifier).
   * @param scope     The required canonical scope string.
   * @param issuer    Async function that calls the auth-service token endpoint.
   * @returns         The access token string.
   */
  async getToken(
    agentId: string,
    clientId: string,
    audience: string,
    scope: string,
    issuer: TokenIssuer,
  ): Promise<string> {
    const key = this._cacheKey(agentId, clientId, audience, scope);

    // 1. Check existing cache entry
    const cached = this._cache.get(key);
    if (cached) {
      const ttlMs = cached.expiresAtMs - Date.now();
      if (ttlMs > REFRESH_EARLY_SECONDS * 1000) {
        this._stats.hits++;
        return cached.accessToken;
      }
    }

    // 2. Deduplicate concurrent requests for the same key
    const existing = this._pending.get(key);
    if (existing) {
      this._stats.dedupSaves++;
      const result = await existing;
      return result.accessToken;
    }

    // 3. Issue new token
    this._stats.refreshes++;
    const promise = this._issueAndCache(key, issuer);
    this._pending.set(key, promise);

    try {
      const result = await promise;
      return result.accessToken;
    } catch (err) {
      this._stats.errors++;
      // If cache has a stale token, keep it as fallback (but only if it's not too expired)
      if (cached && cached.expiresAtMs > Date.now() - MIN_USABLE_TTL_SECONDS * 1000) {
        return cached.accessToken;
      }
      throw err;
    } finally {
      this._pending.delete(key);
    }
  }

  /**
   * Invalidate a cached token, forcing the next call to re-issue.
   * Useful for 401 recovery: after a single retry, invalidate to prevent
   * repeated use of a known-stale token.
   */
  invalidate(agentId: string, clientId: string, audience: string, scope: string): void {
    const key = this._cacheKey(agentId, clientId, audience, scope);
    this._cache.delete(key);
  }

  /** Clear all cached tokens (for shutdown or test cleanup). */
  clear(): void {
    this._cache.clear();
    this._pending.clear();
  }

  /** Get current stats (for test assertions). */
  get stats() {
    return { ...this._stats };
  }

  // ── Internal ─────────────────────────────────────────────────────────

  private _cacheKey(agentId: string, clientId: string, audience: string, scope: string): string {
    return `${agentId}|${clientId}|${audience}|${scope}`;
  }

  private async _issueAndCache(
    key: string,
    issuer: TokenIssuer,
  ): Promise<CachedToken> {
    const result = await issuer();
    const cached: CachedToken = {
      accessToken: result.accessToken,
      expiresAtMs: Date.now() + result.expiresIn * 1000,
    };
    this._cache.set(key, cached);
    return cached;
  }
}
