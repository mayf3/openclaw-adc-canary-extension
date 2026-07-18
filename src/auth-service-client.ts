/**
 * auth-service OAuth client for Direct Token acquisition.
 *
 * Implements the Agent Direct Token contract (confirmed in Phase -1):
 *   POST /oauth/token
 *   Content-Type: application/x-www-form-urlencoded
 *   Authorization: Basic base64(client_id:client_secret)
 *   Body: grant_type=client_credentials&resource=svc-workflow&scope=<scopes>
 *
 * Response (200):
 *   { access_token, token_type: "Bearer", expires_in: 600, scope }
 *
 * The token is signed with RS256 when resource=svc-workflow.
 * See auth-service main @ 3af27e7c: src/lib/oauth/token-issuance.ts
 *
 * Security:
 *   - Token never returned to caller (only used internally)
 *   - Fail closed on non-2xx, malformed response, missing fields
 *   - Redirects disabled
 *   - Timeout bounded
 *   - No unbounded retries
 *   - Token not logged or persisted
 */

// ─── Types ────────────────────────────────────────────────────────────────

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export interface RequestTokenParams {
  /** auth-service origin (e.g. http://127.0.0.1:4001). */
  authServiceOrigin: string;
  /** OAuth client ID (MachineClient.clientId, e.g. "mc_xxxxx"). */
  clientId: string;
  /** Machine client secret (read from secret file). */
  clientSecret: string;
  /** Target resource/audience (e.g. "svc-workflow"). */
  resource: string;
  /** Space-separated scope string (e.g. "workflow.read"). */
  scope: string;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 10_000;

// ─── Token Request ────────────────────────────────────────────────────────

/**
 * Request an Agent Direct Token from the auth-service.
 *
 * @returns TokenResponse with access_token, token_type, expires_in, scope.
 * @throws Error on non-2xx response, malformed body, missing fields,
 *         or unexpected token_type.
 */
export async function requestDirectToken(
  params: RequestTokenParams,
): Promise<TokenResponse> {
  const {
    authServiceOrigin,
    clientId,
    clientSecret,
    resource,
    scope,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = params;

  // ── 1. Validate origin ──────────────────────────────────────────────
  let baseUrl: URL;
  try {
    baseUrl = new URL(authServiceOrigin);
  } catch {
    throw new Error(`Invalid auth-service origin`);
  }

  // Only loopback HTTP allowed for V0 (Phase 4 decision)
  if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') {
    throw new Error(`Invalid auth-service origin protocol`);
  }
  if (baseUrl.hostname !== '127.0.0.1' && baseUrl.hostname !== 'localhost') {
    throw new Error(`Auth-service origin must be loopback (127.0.0.1 or localhost)`);
  }

  const tokenUrl = `${authServiceOrigin}/oauth/token`;

  // ── 2. Build Basic auth header ──────────────────────────────────────
  const credentials = `${clientId}:${clientSecret}`;
  const encoded = Buffer.from(credentials, 'utf-8').toString('base64');

  // ── 3. Build request body ───────────────────────────────────────────
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    resource,
    scope,
  });

  // ── 4. Make HTTP request ────────────────────────────────────────────
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${encoded}`,
      },
      body: body.toString(),
      signal: controller.signal,
      // Explicitly disable redirect following
      redirect: 'manual',
    });

    // ── 5. Handle non-2xx responses ───────────────────────────────────
    if (!response.ok) {
      let errorBody: string | undefined;
      try {
        errorBody = await response.text();
      } catch {
        // Ignore body parse errors
      }

      // Try to extract OAuth error from body
      let oauthError = 'unknown_error';
      if (errorBody) {
        try {
          const parsed = JSON.parse(errorBody);
          if (typeof parsed.error === 'string') {
            oauthError = parsed.error;
          }
        } catch {
          // Not JSON — use status text
          oauthError = response.statusText || 'unknown_error';
        }
      }

      throw new Error(
        `Token request failed: HTTP ${response.status} ${oauthError}`,
      );
    }

    // ── 6. Parse response ─────────────────────────────────────────────
    let json: any;
    try {
      json = await response.json();
    } catch {
      throw new Error('Token response: malformed JSON body');
    }

    // ── 7. Validate response fields ───────────────────────────────────
    if (typeof json.access_token !== 'string' || !json.access_token) {
      throw new Error('Token response: missing or invalid access_token');
    }
    if (json.token_type !== 'Bearer') {
      throw new Error(
        `Token response: unexpected token_type "${json.token_type}" (expected "Bearer")`,
      );
    }
    if (typeof json.expires_in !== 'number' || json.expires_in <= 0) {
      throw new Error('Token response: missing or invalid expires_in');
    }

    // ── 8. Reject if refresh_token is present (should not happen) ─────
    if (json.refresh_token !== undefined) {
      throw new Error('Token response: unexpected refresh_token (fail closed)');
    }

    return {
      access_token: json.access_token,
      token_type: json.token_type,
      expires_in: json.expires_in,
      scope: typeof json.scope === 'string' ? json.scope : scope,
    };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`Token request timed out after ${timeoutMs}ms`);
    }
    // Re-throw with masked details (no secret exposure)
    throw new Error(`Token request failed: ${err.message}`);
  } finally {
    clearTimeout(timeoutId);
  }
}
