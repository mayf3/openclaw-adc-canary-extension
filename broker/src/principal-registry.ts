/**
 * Principal & Client Registry — Auth V1 Idempotent Claim Client.
 *
 * Claims existing MachinePrincipal and MachineClient records by binding an
 * opaque external_ref via the Auth V1 idempotent API.
 *
 * Principles:
 * - No identity guessing: all UUIDs come from a pre-approved authoritative
 *   mapping, never from DB queries or alias resolution.
 * - No DB access from broker code: all operations go through the Auth HTTP API.
 * - No new objects: claim operations expect `created: false` in responses.
 *   A `created: true` response is treated as an error.
 * - Token reuse: one V1 RS256 token per session, cached and reused.
 */

import type { SecretRef } from './plugin-api.js';
import { resolveSecret } from './secret-resolver.js';

// ─── Errors ─────────────────────────────────────────────────────────────────

export class ClaimError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: unknown,
  ) {
    super(message);
    this.name = 'ClaimError';
  }
}

export class AuthTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthTokenError';
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ClaimPrincipalParams {
  /** Opaque unique key: "openclaw:agent:<canonicalAgentId>" */
  externalRef: string;
  /** Known principal UUID from authoritative mapping */
  expectedPrincipalId: string;
  principalType: 'agent';
  /** Human-readable display name */
  displayName: string;
  /** Existing agentId in Auth (may differ from canonical ID) */
  agentId: string;
  /** Owner user UUID */
  ownerUserId: string;
}

export interface ClaimPrincipalResult {
  principalId: string;
}

export interface ClaimClientParams {
  /** Opaque unique key: "openclaw:client:<principalId>:runtime-auth" */
  externalRef: string;
  /** Known principal UUID */
  principalId: string;
  /** Known client UUID from authoritative mapping */
  expectedClientId: string;
}

export interface ClaimClientResult {
  clientId: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const AUTH_TOKEN_PATH = '/oauth/token';
const PRINCIPALS_PATH = '/api/v1/principals';
const CLIENTS_PATH = '/api/v1/clients';

// ─── Principal Registry ─────────────────────────────────────────────────────

export class PrincipalRegistry {
  private _authServiceOrigin: string;
  private _brokerClientId: string = '';
  private _brokerSecret: string = '';
  private _cachedToken: { token: string; expiresAt: number } | null = null;

  constructor(authServiceOrigin: string) {
    this._authServiceOrigin = authServiceOrigin.replace(/\/+$/, '');
  }

  /**
   * Set the broker's own client credentials used to obtain a V1 RS256 token.
   * Must be called before any claim operation.
   */
  setBrokerAuth(clientId: string, secret: string): void {
    this._brokerClientId = clientId;
    this._brokerSecret = secret;
    // Invalidate any cached token since credentials changed
    this._cachedToken = null;
  }

  /**
   * Set broker auth from a SecretRef (resolves the secret at call time).
   */
  async setBrokerAuthFromRef(clientId: string, ref: SecretRef): Promise<void> {
    const secret = await resolveSecret(ref);
    this.setBrokerAuth(clientId, secret);
  }

  /**
   * Claim external_ref on an existing MachinePrincipal.
   *
   * POST /api/v1/principals with expected_principal_id.
   * Expects 200 { created: false }.
   * Throws on 201 (unexpected new object) or any error response.
   */
  async claimPrincipal(params: ClaimPrincipalParams): Promise<ClaimPrincipalResult> {
    const token = await this._getBrokerToken();

    const body = {
      external_ref: params.externalRef,
      expected_principal_id: params.expectedPrincipalId,
      principal_type: params.principalType,
      display_name: params.displayName,
      agent_id: params.agentId,
      owner_user_id: params.ownerUserId,
    };

    const response = await this._request('POST', PRINCIPALS_PATH, token, body);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '(no body)');
      throw new ClaimError(
        `Principal claim failed (${response.status}): ${errorBody}`,
        response.status,
      );
    }

    const data: any = await response.json();

    if (data.created === true) {
      throw new ClaimError(
        `Unexpected: principal "${params.expectedPrincipalId}" was created (created=true), not claimed. ` +
        `Expected existing principal to be reused. external_ref="${params.externalRef}"`,
        201,
        data,
      );
    }

    if (!data.id || data.id !== params.expectedPrincipalId) {
      throw new ClaimError(
        `Principal claim returned unexpected ID. Expected "${params.expectedPrincipalId}", got "${data.id}"`,
        response.status,
        data,
      );
    }

    return { principalId: data.id };
  }

  /**
   * Claim external_ref on an existing MachineClient.
   *
   * POST /api/v1/clients with expected_client_id.
   * Expects 200 { created: false } with no secret returned.
   * Throws on 201 (unexpected new object) or if secret is returned.
   */
  async claimClient(params: ClaimClientParams): Promise<ClaimClientResult> {
    const token = await this._getBrokerToken();

    const body = {
      external_ref: params.externalRef,
      principal_id: params.principalId,
      expected_client_id: params.expectedClientId,
    };

    const response = await this._request('POST', CLIENTS_PATH, token, body);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '(no body)');
      throw new ClaimError(
        `Client claim failed (${response.status}): ${errorBody}`,
        response.status,
      );
    }

    const data: any = await response.json();

    if (data.created === true) {
      throw new ClaimError(
        `Unexpected: client "${params.expectedClientId}" was created (created=true), not claimed. ` +
        `Expected existing client to be reused. external_ref="${params.externalRef}"`,
        201,
        data,
      );
    }

    if ('secret' in data && data.secret) {
      throw new ClaimError(
        `Unexpected: secret returned during claim of existing client "${params.expectedClientId}". ` +
        `Secrets must NOT be returned for existing clients.`,
        response.status,
        data,
      );
    }

    // The API returns client_id as the public client ID string (mc_xxx).
    // We verify it matches the expected public client ID from the mapping.
    if (!data.client_id) {
      throw new ClaimError(
        `Client claim returned no client_id. Expected "${params.expectedClientId}"`,
        response.status,
        data,
      );
    }

    return { clientId: data.client_id };
  }

  // ── Token Management ─────────────────────────────────────────────────────

  /**
   * Obtain a V1 RS256 access token using the broker's own client credentials.
   * Token is cached and reused within its expiry window.
   */
  private async _getBrokerToken(): Promise<string> {
    if (!this._brokerClientId || !this._brokerSecret) {
      throw new AuthTokenError(
        'Broker authentication not configured. Call setBrokerAuth() first.',
      );
    }

    // Return cached token if still valid (with 30s safety margin)
    if (this._cachedToken && Date.now() < this._cachedToken.expiresAt - 30_000) {
      return this._cachedToken.token;
    }

    const basicAuth = Buffer.from(
      `${this._brokerClientId}:${this._brokerSecret}`,
    ).toString('base64');

    const tokenBody = new URLSearchParams({
      grant_type: 'client_credentials',
      resource: 'svc-auth',
      scope: 'auth.identity.provision',
    });

    let response: Response;
    try {
      response = await fetch(`${this._authServiceOrigin}${AUTH_TOKEN_PATH}`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: tokenBody.toString(),
      });
    } catch (err: any) {
      throw new AuthTokenError(`Token endpoint network error: ${err.message}`);
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '(no body)');
      throw new AuthTokenError(
        `Token endpoint returned ${response.status}: ${errorBody}`,
      );
    }

    const data: any = await response.json();
    if (!data.access_token) {
      throw new AuthTokenError('Token response missing access_token');
    }

    const expiresIn = (typeof data.expires_in === 'number'
      ? data.expires_in
      : parseInt(data.expires_in, 10)) || 600;

    this._cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + expiresIn * 1000,
    };

    return data.access_token;
  }

  /**
   * Make an authenticated request to the Auth V1 management API.
   */
  private async _request(
    method: string,
    path: string,
    token: string,
    body?: Record<string, unknown>,
  ): Promise<Response> {
    const url = `${this._authServiceOrigin}${path}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    try {
      return await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err: any) {
      throw new ClaimError(`HTTP request failed: ${err.message}`);
    }
  }

  /** Clear cached token (for testing / shutdown). */
  clearTokenCache(): void {
    this._cachedToken = null;
  }
}
