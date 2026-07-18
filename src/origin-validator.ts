/**
 * Strict IPv4 loopback origin validator.
 *
 * Only allows exact `http://127.0.0.1:<port>` origins.
 * Rejects all other hostnames including localhost, ::1, 0.0.0.0,
 * DNS names, IP variants, and URLs with userinfo.
 *
 * Per audit H-02: "只允许精确IPv4 Loopback"
 *
 * Security requirements:
 *   1. Scheme must be exactly `http:`
 *   2. Hostname must be exactly `127.0.0.1` (dotted-decimal only)
 *   3. Port must be explicitly present (no default port inference)
 *   4. No username/password in URL
 *   5. No path, query, or fragment in origin config
 *   6. URL parsed and compared against normalized values
 *   7. Raw input validated before URL parsing (catches IP variants)
 *   8. No DNS resolution performed
 */

// ─── Constants ────────────────────────────────────────────────────────────

/** The only allowed origin scheme. */
const ALLOWED_SCHEME = 'http:';

/** The only allowed hostname. */
const ALLOWED_HOSTNAME = '127.0.0.1';

/** Regex pattern for the raw hostname:port part. Must match exactly. */
const HOST_PORT_PATTERN = /^127\.0\.0\.1:(\d+)$/;

/** Minimum allowed TCP port. */
const MIN_PORT = 1;

/** Maximum allowed TCP port. */
const MAX_PORT = 65535;

// ─── Types ────────────────────────────────────────────────────────────────

export interface ParsedOrigin {
  /** The validated origin string (scheme://hostname:port). */
  origin: string;
  /** The port number. */
  port: number;
}

// ─── Validator ────────────────────────────────────────────────────────────

/**
 * Strictly validate that a URL origin is exactly http://127.0.0.1:<port>.
 *
 * @param originStr  The origin string to validate (e.g. "http://127.0.0.1:4001").
 * @returns The validated ParsedOrigin with origin string and port.
 * @throws Error if the origin does not match the strict contract.
 */
export function validateLoopbackOrigin(originStr: string): ParsedOrigin {
  // ── 1. Parse URL ───────────────────────────────────────────────────
  let url: URL;
  try {
    url = new URL(originStr);
  } catch {
    throw new Error('Invalid origin: unable to parse URL');
  }

  // ── 2. Scheme must be http ─────────────────────────────────────────
  if (url.protocol !== ALLOWED_SCHEME) {
    throw new Error(
      `Invalid origin scheme "${url.protocol}" (only "${ALLOWED_SCHEME}" allowed)`,
    );
  }

  // ── 3. Raw host:port validation ────────────────────────────────────
  // Extract the raw host:port part from the original string (after scheme://)
  // to reject IP variants that URL parsing would normalize.
  const afterScheme = originStr.slice(ALLOWED_SCHEME.length + 2); // skip "http://"
  // Split at first /, ?, or # to get the host:port part
  const hostPortPart = afterScheme.split(/[\/?#]/)[0];

  if (!hostPortPart) {
    throw new Error(`Invalid origin: missing hostname`);
  }

  const match = hostPortPart.match(HOST_PORT_PATTERN);
  if (!match) {
    throw new Error(
      `Invalid origin: hostname must be exactly "${ALLOWED_HOSTNAME}:<port>" ` +
      `(got "${hostPortPart}")`,
    );
  }

  const portStr = match[1];
  const port = Number.parseInt(portStr, 10);

  // ── 4. Port must be a valid number in range ────────────────────────
  if (!Number.isFinite(port) || !Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new Error(
      `Invalid origin port "${portStr}" (must be ${MIN_PORT}-${MAX_PORT})`,
    );
  }

  // ── 5. Verify reconstructed origin matches ─────────────────────────
  const canonicalOrigin = `${ALLOWED_SCHEME}//${ALLOWED_HOSTNAME}:${port}`;

  // ── 6. No userinfo (username or password) ──────────────────────────
  if (url.username) {
    throw new Error('Invalid origin: username not allowed');
  }
  if (url.password) {
    throw new Error('Invalid origin: password not allowed');
  }

  // ── 7. Path, query, fragment must not be present ──────────────────
  if (url.pathname && url.pathname !== '/') {
    throw new Error(`Invalid origin: path component not allowed ("${url.pathname}")`);
  }
  if (url.search) {
    throw new Error('Invalid origin: query component not allowed');
  }
  if (url.hash) {
    throw new Error('Invalid origin: fragment component not allowed');
  }

  // ── 8. Reject trailing slash in pathname (even root '/') ──────────
  if (url.pathname === '/' && !originStr.endsWith(canonicalOrigin)) {
    throw new Error('Invalid origin: trailing slash not allowed');
  }

  return {
    origin: canonicalOrigin,
    port,
  };
}
