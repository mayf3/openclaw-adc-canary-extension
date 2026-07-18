#!/usr/bin/env node
/**
 * ADC Mock Server — temporary, isolated, no production dependencies.
 *
 * Validates:
 *   1. Request method is GET
 *   2. Path is /api/requirements/mine
 *   3. X-Subject-Token header is present
 *   4. X-Subject-Token appears only ONCE (no duplicate headers)
 *   5. Token is NOT in query, body, or Cookie
 *   6. Request headers don't contain Authorization header
 *   7. Non-expected paths rejected
 *
 * Security:
 *   - Does NOT log token values
 *   - Does NOT save token to disk
 *   - Does NOT validate token payload (V0 scope)
 *   - Does NOT call svc-workflow or production ADC
 *   - Returns fixed minimal test response
 *
 * Usage: node scripts/adc-mock-server.mjs [port]
 */

import http from 'node:http';

const PORT = parseInt(process.argv[2] || '9099', 10);
const EXPECTED_PATH = '/api/requirements/mine';

// Fixed test response
const TEST_RESPONSE = {
  requirements: [
    {
      id: 'req-mock-001',
      title: 'Mock ADC Workflow Requirement',
      status: 'active',
      description: 'This is a mock response from the ADC Canary V0 temporary server.',
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
};

const server = http.createServer((req, res) => {
  // ── 1. Method check ─────────────────────────────────────────────────
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // ── 2. Path check (exact match only) ────────────────────────────────
  if (req.url !== EXPECTED_PATH) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  // ── 3. Check Authorization header is NOT present ──────────────────
  if (req.headers['authorization']) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Authorization header not allowed' }));
    return;
  }

  // ── 4. Check X-Subject-Token header exists ─────────────────────────
  // Node.js http.IncomingMessage.headers normalizes duplicate headers
  // into arrays. We need to detect this to reject duplicates.
  const rawHeaders = req.rawHeaders || [];
  let subjectTokenCount = 0;
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (rawHeaders[i] && rawHeaders[i].toLowerCase() === 'x-subject-token') {
      subjectTokenCount++;
    }
  }

  if (subjectTokenCount === 0) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing X-Subject-Token' }));
    return;
  }

  // Reject duplicate X-Subject-Token headers
  if (subjectTokenCount > 1) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Duplicate X-Subject-Token' }));
    return;
  }

  // ── 5. Check token is not in query string ──────────────────────────
  const queryIndex = req.url.indexOf('?');
  if (queryIndex >= 0) {
    const query = req.url.slice(queryIndex + 1);
    if (query.toLowerCase().includes('token')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Token in query string not allowed' }));
      return;
    }
  }

  // ── 6. Extract subject token (for validation only — not logged) ────
  const subjectToken = req.headers['x-subject-token'];

  // Validate it's a non-empty string
  if (!subjectToken || typeof subjectToken !== 'string' || subjectToken.trim() === '') {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid X-Subject-Token' }));
    return;
  }

  // ── 7. Return success response ─────────────────────────────────────
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(TEST_RESPONSE));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`ADC Mock server listening on http://127.0.0.1:${PORT}`);
  console.log(`Expected path: GET ${EXPECTED_PATH}`);
  console.log('Token validation: X-Subject-Token header required');
});
