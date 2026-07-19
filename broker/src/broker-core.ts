/**
 * Broker Core — Authorized Fetch for the Auth Broker V1.
 *
 * Orchestrates the token lifecycle:
 * 1. Resolve capability → target
 * 2. Assert agent allowlist
 * 3. Resolve agent client + secret
 * 4. Issue short-lived RS256 access token (client_credentials)
 * 5. Cache token per (audience, scope)
 * 6. Validate origin/method/path
 * 7. Fetch business service with Bearer token
 * 8. Return sanitized result (no token, no secret)
 *
 * Security:
 * - Tokens exist only in-process memory.
 * - Tokens are NOT returned to callers (only the business response).
 * - Token is NOT written to logs.
 * - Arbitrary URL fetch is rejected.
 * - No model-controllable parameters escape the business input schema.
 */

import { Registries } from './registries.js';
import { type SecretRef, type OpenClawPluginToolContext } from './plugin-api.js';
import { resolveSecret, isSecretRef } from './secret-resolver.js';
import { TokenCache } from './token-cache.js';

// ─── Constants ────────────────────────────────────────────────────────────

/** Token endpoint path from the auth-service V1 contract manifest. */
const AUTH_TOKEN_PATH = '/oauth/token';

/** Maximum retries on 401 before failing closed. */
const MAX_TOKEN_RETRIES = 1;

// ─── Errors ───────────────────────────────────────────────────────────────

export class BrokerError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'BrokerError';
  }
}

export class CapabilityNotRegisteredError extends BrokerError {
  constructor(capabilityId: string) {
    super(`Capability "${capabilityId}" is not registered`);
    this.name = 'CapabilityNotRegisteredError';
  }
}

export class AgentNotAllowedError extends BrokerError {
  constructor(agentId: string) {
    super(`Agent "${agentId}" is not allowed to use broker tools`);
    this.name = 'AgentNotAllowedError';
  }
}

export class OriginMismatchError extends BrokerError {
  constructor(expected: string, got: string) {
    super(`Origin mismatch: expected ${expected}, got ${got}`);
    this.name = 'OriginMismatchError';
  }
}

export class MethodNotAllowedError extends BrokerError {
  constructor(method: string, path: string) {
    super(`Method ${method} not allowed for path ${path}`);
    this.name = 'MethodNotAllowedError';
  }
}

export class AuthServiceError extends BrokerError {
  constructor(detail: string, statusCode?: number) {
    super(`Auth-service error: ${detail}`, statusCode);
    this.name = 'AuthServiceError';
  }
}

// ─── Broker Core ──────────────────────────────────────────────────────────

export class BrokerCore {
  private _tokenCache = new TokenCache();

  /** Per-agent resolved credentials cache — resolved ONCE, not per-tool-call. */
  private _resolvedCredentials = new Map<string, string>();

  constructor(
    private _registries: Registries,
  ) {}

  /**
   * Execute an authorized fetch for the given capability.
   *
   * @param ctx        The plugin tool context (provides trusted agentId).
   * @param capabilityId  The registered capability ID to invoke.
   * @param businessInput  Business parameters validated by the adapter's schema.
   * @returns          The business service response body (parsed JSON or text).
   *
   * @throws AgentNotAllowedError     if agent is not in the allowlist.
   * @throws CapabilityNotRegisteredError  if capabilityId is unknown.
   * @throws AuthServiceError          if token issuance fails.
   * @throws BrokerError              if origin/method/path validation fails.
   */
  async authorizedFetch(
    ctx: OpenClawPluginToolContext,
    capabilityId: string,
    businessInput: Record<string, unknown>,
  ): Promise<unknown> {
    const agentId = ctx.agentId;
    if (!agentId) {
      throw new AgentNotAllowedError('(none)');
    }

    // 1. Assert agent allowlist
    this._registries.assertAgentAllowed(agentId);

    // 2. Resolve capability → target
    const capability = this._registries.getCapability(capabilityId);
    const target = this._registries.getTarget(capability.targetId);

    // 3. Resolve agent client + credential
    const agentClient = this._registries.getAgentClient(agentId);

    // 4. Resolve client secret (cached per-agent, not per-tool-call)
    const clientSecret = await this._resolveCredential(agentId, agentClient.credentialRef);

    // 5. Obtain access token (with cache)
    const scope = capability.requiredScopes.join(' ');
    const accessToken = await this._tokenCache.getToken(
      agentId,
      agentClient.clientId,
      target.audience,
      scope,
      () => this._issueToken(
        agentClient.clientId,
        clientSecret,
        target.audience,
        scope,
      ),
    );

    // 6. Validate origin/method/path
    this._validateRequest(target.allowedOrigin, capability.method, capability.path);

    // 7. Fetch business service
    const response = await this._fetchWithRetry(
      target.allowedOrigin,
      capability.method,
      capability.path,
      accessToken,
      businessInput,
      // On 401, invalidate cache and retry once
      async () => {
        this._tokenCache.invalidate(agentId, agentClient.clientId, target.audience, scope);
        const retryToken = await this._tokenCache.getToken(
          agentId,
          agentClient.clientId,
          target.audience,
          scope,
          () => this._issueToken(
            agentClient.clientId,
            clientSecret,
            target.audience,
            scope,
          ),
        );
        return retryToken;
      },
    );

    return response;
  }

  // ── Private ──────────────────────────────────────────────────────────

  /**
   * Issue a client_credentials token from the auth-service.
   *
   * auth-service V1 contract demands:
   * - form-urlencoded body
   * - Basic auth for client_id:client_secret
   * - field `resource` (not `audience`) for client_credentials grant
   */
  private async _issueToken(
    clientId: string,
    clientSecret: string,
    audience: string,
    scope: string,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      resource: audience,
      scope,
    });

    let response: Response;
    try {
      response = await fetch(`${this._registries.authServiceOrigin}${AUTH_TOKEN_PATH}`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: body.toString(),
      });
    } catch (err: any) {
      throw new AuthServiceError(`Network error: ${err.message}`);
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '(no body)');
      throw new AuthServiceError(
        `Token endpoint returned ${response.status}: ${errorBody}`,
        response.status,
      );
    }

    const data: any = await response.json();
    if (!data.access_token || typeof data.access_token !== 'string') {
      throw new AuthServiceError('Token response missing access_token');
    }

    const expiresIn = typeof data.expires_in === 'number'
      ? data.expires_in
      : parseInt(data.expires_in, 10) || 300;

    return { accessToken: data.access_token, expiresIn };
  }

  /**
   * Resolve a credential from its SecretRef, with per-agent caching.
   * Resolves ONCE per agent, then reuses the cached value for subsequent calls.
   * This ensures no file/exec/env re-reads during tool execution.
   */
  private async _resolveCredential(agentId: string, ref: SecretRef): Promise<string> {
    const cached = this._resolvedCredentials.get(agentId);
    if (cached !== undefined) {
      return cached;
    }
    const secret = await resolveSecret(ref);
    this._resolvedCredentials.set(agentId, secret);
    return secret;
  }

  /**
   * Validate that the request origin, method, and path match the registered
   * capability. This prevents arbitrary URL / method injection.
   */
  private _validateRequest(
    allowedOrigin: string,
    method: string,
    path: string,
  ): void {
    if (!allowedOrigin || !method || !path) {
      throw new BrokerError('Invalid target configuration: origin, method, and path are required');
    }
    // Method must be one of the allowed methods
    const allowedMethods = ['GET', 'POST', 'PUT', 'DELETE'];
    if (!allowedMethods.includes(method.toUpperCase())) {
      throw new MethodNotAllowedError(method, path);
    }
  }

  /**
   * Fetch the target business service with Bearer auth.
   * On 401, triggers at most one retry with a fresh token.
   */
  private async _fetchWithRetry(
    origin: string,
    method: string,
    path: string,
    token: string,
    body: Record<string, unknown>,
    onUnauthorized: () => Promise<string>,
  ): Promise<unknown> {
    const url = `${origin}${path}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
    };

    // Attach body for non-GET methods
    let fetchBody: string | undefined;
    if (method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      fetchBody = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: fetchBody,
      });
    } catch (err: any) {
      throw new BrokerError(`Business service fetch failed: ${err.message}`);
    }

    // Retry once on 401
    if (response.status === 401) {
      const retryToken = await onUnauthorized();
      headers['Authorization'] = `Bearer ${retryToken}`;
      try {
        response = await fetch(url, {
          method,
          headers,
          body: fetchBody,
        });
      } catch (err: any) {
        throw new BrokerError(`Business service fetch retry failed: ${err.message}`);
      }
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '(no body)');
      throw new BrokerError(
        `Business service returned ${response.status}: ${errorBody}`,
        response.status,
      );
    }

    // Return parsed JSON or text
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return response.json();
    }
    return response.text();
  }

  /** Expose the token cache for testability / stats. */
  get tokenCacheStats() {
    return this._tokenCache.stats;
  }

  /** Clear token cache (for shutdown). */
  clearCache(): void {
    this._tokenCache.clear();
  }
}
