/**
 * Proxy environment variable guard (M-06).
 *
 * Node.js v25.6.1 built-in fetch (via undici) respects HTTP_PROXY and
 * HTTPS_PROXY environment variables by default. Since the canary only
 * connects to 127.0.0.1 loopback addresses, any proxy configuration
 * could redirect requests to unintended destinations.
 *
 * This module provides:
 *   - Startup validation: refuses to operate if proxy env vars are set
 *   - Runtime check: validates no proxy override at request time
 *
 * Security contract (M-06):
 *   Requests must only connect directly to exact 127.0.0.1 targets.
 *   No proxy should be involved in any canary network request.
 */

// ─── Proxy environment variables to check ─────────────────────────────────

const PROXY_ENV_VARS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'GLOBAL_AGENT_HTTP_PROXY',
  'GLOBAL_AGENT_HTTPS_PROXY',
];

/**
 * Check if any proxy environment variable is set.
 *
 * @returns Array of set proxy variable names (empty if none).
 */
export function getSetProxyEnvVars(): string[] {
  const set: string[] = [];
  for (const name of PROXY_ENV_VARS) {
    const value = process.env[name];
    if (value && value.trim().length > 0) {
      set.push(name);
    }
  }
  return set;
}

/**
 * Validate that no proxy environment variables are set.
 * Throws if any proxy env var is found.
 *
 * Call this at startup to fail fast if proxy would redirect requests.
 */
export function assertNoProxyConfigured(): void {
  const set = getSetProxyEnvVars();
  if (set.length > 0) {
    throw new Error(
      `Proxy environment variable detected: ${set.join(', ')}. ` +
      'Canary V0 requires direct 127.0.0.1 connections only. ' +
      'Unset proxy variables or use NO_PROXY=127.0.0.1.',
    );
  }
}

/**
 * Verify at request time that proxy env hasn't been injected.
 * This is a defense-in-depth check alongside the startup validation.
 */
export function checkProxyAtRequestTime(): void {
  const set = getSetProxyEnvVars();
  if (set.length > 0) {
    throw new Error(
      `Proxy config detected at request time (${set.join(', ')}): refusing request.`,
    );
  }
}
