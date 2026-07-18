/**
 * ADC Mock HTTP client.
 *
 * Sends trusted requests to the temporary ADC Mock server.
 * The Direct Token is sent via X-Subject-Token header.
 *
 * Security:
 *   - Only connects to the configured ADC Mock origin
 *   - Fixed path: GET /api/requirements/mine
 *   - No redirects
 *   - Token in header only (not in body, query, or cookie)
 *   - Token not logged or returned to caller
 *   - Fail closed on any non-2xx response
 */

// ─── Types ────────────────────────────────────────────────────────────────

export interface AdcReadResult {
  /** Raw JSON response from the ADC Mock. */
  data: unknown;
  /** HTTP status code. */
  status: number;
}

export interface ReadAdcParams {
  /** ADC Mock origin (e.g. http://127.0.0.1:9099). */
  adcMockOrigin: string;
  /** Agent Direct Token (Bearer token). */
  accessToken: string;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────

const ADC_READ_PATH = '/api/requirements/mine';
const DEFAULT_TIMEOUT_MS = 10_000;

// ─── ADC Read Request ─────────────────────────────────────────────────────

/**
 * Read ADC workflow requirements from the ADC Mock.
 *
 * @returns The parsed JSON response.
 * @throws Error on non-2xx, timeout, redirect, or network error.
 */
export async function readAdcRequirements(
  params: ReadAdcParams,
): Promise<AdcReadResult> {
  const {
    adcMockOrigin,
    accessToken,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = params;

  // ── 1. Validate origin ──────────────────────────────────────────────
  let baseUrl: URL;
  try {
    baseUrl = new URL(adcMockOrigin);
  } catch {
    throw new Error('Invalid ADC Mock origin');
  }

  // Only loopback HTTP allowed for V0
  if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') {
    throw new Error('Invalid ADC Mock origin protocol');
  }
  if (baseUrl.hostname !== '127.0.0.1' && baseUrl.hostname !== 'localhost') {
    throw new Error('ADC Mock origin must be loopback (127.0.0.1 or localhost)');
  }

  const url = `${adcMockOrigin}${ADC_READ_PATH}`;

  // ── 2. Make HTTP request ────────────────────────────────────────────
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Subject-Token': accessToken,
      },
      signal: controller.signal,
      // Explicitly disable redirect following
      redirect: 'manual',
    });

    // ── 3. Handle non-2xx / redirect responses ────────────────────────
    if (response.status >= 300 && response.status < 400) {
      throw new Error(
        `ADC Mock returned redirect (HTTP ${response.status}) — redirects disabled`,
      );
    }

    if (!response.ok) {
      throw new Error(
        `ADC Mock request failed: HTTP ${response.status}`,
      );
    }

    // ── 4. Parse response ─────────────────────────────────────────────
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new Error('ADC Mock response: malformed JSON body');
    }

    return {
      data,
      status: response.status,
    };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`ADC Mock request timed out after ${timeoutMs}ms`);
    }
    throw new Error(`ADC Mock request failed: ${err.message}`);
  } finally {
    clearTimeout(timeoutId);
  }
}
