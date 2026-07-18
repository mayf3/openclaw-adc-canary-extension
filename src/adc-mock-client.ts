/**
 * ADC Mock HTTP client.
 *
 * Sends trusted requests to the temporary ADC Mock server.
 * The Direct Token is sent via X-Subject-Token header.
 *
 * Security:
 *   - Only connects to the configured ADC Mock origin (H-02)
 *   - Fixed path: GET /api/requirements/mine
 *   - No redirects
 *   - Token in header only (not in body, query, or cookie)
 *   - Token not logged or returned to caller
 *   - Fail closed on any non-2xx response
 */

import { validateLoopbackOrigin } from './origin-validator.js';
import { checkProxyAtRequestTime } from './proxy-guard.js';

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

  // ── 1. Validate origin via shared validator (H-02) ─────────────────
  const parsed = validateLoopbackOrigin(adcMockOrigin);
  const url = `${parsed.origin}${ADC_READ_PATH}`;

  // ── 1b. Check proxy not configured (M-06) ─────────────────────────
  checkProxyAtRequestTime();

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
