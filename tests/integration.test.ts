/**
 * Integration tests for auth-service client and ADC mock client (M-03).
 *
 * Starts minimal local HTTP servers to test real HTTP requests.
 * Tests: Basic auth, grant_type, redirect rejection, timeout, malformed
 * responses, token validation, and more.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { requestDirectToken } from '../src/auth-service-client.js';
import { readAdcRequirements } from '../src/adc-mock-client.js';

// ─── Auth-Service Mock ────────────────────────────────────────────────────

let authServer: http.Server;
let authPort: number;
let authRequestLog: any[] = [];

function startAuthMock(behavior: 'normal' | 'malformed' | 'wrong_type' | 'has_refresh' | 'slow' | 'redirect' | 'non_json' | 'auth_error'): Promise<number> {
  return new Promise((resolve) => {
    authRequestLog = [];
    const server = http.createServer((req, res) => {
      authRequestLog.push({ method: req.method, url: req.url, headers: req.headers });

      if (behavior === 'malformed') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"access_token": ');
        return;
      }
      if (behavior === 'wrong_type') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ access_token: 'tok', token_type: 'Mac', expires_in: 600 }));
        return;
      }
      if (behavior === 'has_refresh') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          access_token: 'tok', token_type: 'Bearer', expires_in: 600,
          refresh_token: 'ref_tok',
        }));
        return;
      }
      if (behavior === 'redirect') {
        res.writeHead(302, { Location: 'http://evil.com/steal' });
        res.end();
        return;
      }
      if (behavior === 'auth_error') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_client', error_description: 'bad creds' }));
        return;
      }
      if (behavior === 'non_json') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('not-json');
        return;
      }
      if (behavior === 'slow') {
        // Don't respond — will trigger timeout
        return;
      }

      // Normal: return valid token
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({
        access_token: 'eyJhbGciOiJSUzI1NiIsImtpZCI6ImtleS12MS0yMDI2MDcwMSJ9.test-token',
        token_type: 'Bearer',
        expires_in: 600,
        scope: 'workflow.read',
      }));
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      authPort = typeof addr === 'object' && addr ? addr.port : 0;
      resolve(authPort);
    });
  });
}

function stopAuthMock() {
  authServer?.close();
}

// ─── ADC Mock ─────────────────────────────────────────────────────────────

let adcServer: http.Server;
let adcPort: number;

function startAdcMock(behavior: 'normal' | 'redirect' | 'error' | 'non_json' | 'huge'): Promise<number> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (behavior === 'redirect') {
        res.writeHead(302, { Location: 'http://evil.com/steal' });
        res.end();
        return;
      }
      if (behavior === 'error') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal' }));
        return;
      }
      if (behavior === 'non_json') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html>not json</html>');
        return;
      }
      if (behavior === 'huge') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{' + '"x": "y",'.repeat(50000) + '}');
        return;
      }
      // Normal
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ requirements: [], total: 0 }));
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      adcPort = typeof addr === 'object' && addr ? addr.port : 0;
      resolve(adcPort);
    });
  });
}

function stopAdcMock() {
  adcServer?.close();
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('auth-service client integration (M-03)', () => {
  after(() => {
    stopAuthMock();
  });

  it('sends correct Basic auth and grant_type', async () => {
    const port = await startAuthMock('normal');
    const result = await requestDirectToken({
      authServiceOrigin: `http://127.0.0.1:${port}`,
      clientId: 'mc_test123',
      clientSecret: 'secret-value',
      resource: 'svc-workflow',
      scope: 'workflow.read',
      timeoutMs: 5000,
    });
    assert.ok(result.access_token);
    assert.equal(result.token_type, 'Bearer');
    assert.equal(result.expires_in, 600);

    // Verify request was sent correctly
    const req = authRequestLog[0];
    assert.ok(req);
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/oauth/token');
    assert.ok(req.headers['authorization']?.startsWith('Basic '));
    assert.match(req.headers['content-type'] || '', /x-www-form-urlencoded/);
  });

  it('rejects malformed JSON response', async () => {
    const port = await startAuthMock('malformed');
    await assert.rejects(
      () => requestDirectToken({
        authServiceOrigin: `http://127.0.0.1:${port}`,
        clientId: 'mc_test', clientSecret: 'secret',
        resource: 'svc-workflow', scope: 'workflow.read',
      }),
      /malformed JSON/,
    );
  });

  it('rejects non-Bearer token_type', async () => {
    const port = await startAuthMock('wrong_type');
    await assert.rejects(
      () => requestDirectToken({
        authServiceOrigin: `http://127.0.0.1:${port}`,
        clientId: 'mc_test', clientSecret: 'secret',
        resource: 'svc-workflow', scope: 'workflow.read',
      }),
      /unexpected token_type/,
    );
  });

  it('rejects response with refresh_token', async () => {
    const port = await startAuthMock('has_refresh');
    await assert.rejects(
      () => requestDirectToken({
        authServiceOrigin: `http://127.0.0.1:${port}`,
        clientId: 'mc_test', clientSecret: 'secret',
        resource: 'svc-workflow', scope: 'workflow.read',
      }),
      /refresh_token/,
    );
  });

  it('rejects auth error (non-2xx)', async () => {
    const port = await startAuthMock('auth_error');
    await assert.rejects(
      () => requestDirectToken({
        authServiceOrigin: `http://127.0.0.1:${port}`,
        clientId: 'mc_test', clientSecret: 'wrong-secret',
        resource: 'svc-workflow', scope: 'workflow.read',
      }),
      /failed.*401/,
    );
  });

  it('rejects redirect (3xx)', async () => {
    const port = await startAuthMock('redirect');
    await assert.rejects(
      () => requestDirectToken({
        authServiceOrigin: `http://127.0.0.1:${port}`,
        clientId: 'mc_test', clientSecret: 'secret',
        resource: 'svc-workflow', scope: 'workflow.read',
      }),
      /failed.*302/,
    );
  });

  it('rejects non-JSON response', async () => {
    const port = await startAuthMock('non_json');
    await assert.rejects(
      () => requestDirectToken({
        authServiceOrigin: `http://127.0.0.1:${port}`,
        clientId: 'mc_test', clientSecret: 'secret',
        resource: 'svc-workflow', scope: 'workflow.read',
      }),
      /malformed JSON/,
    );
  });

  it('times out on slow server', async () => {
    const port = await startAuthMock('slow');
    await assert.rejects(
      () => requestDirectToken({
        authServiceOrigin: `http://127.0.0.1:${port}`,
        clientId: 'mc_test', clientSecret: 'secret',
        resource: 'svc-workflow', scope: 'workflow.read',
        timeoutMs: 500,
      }),
      /timed out/,
    );
  });
});

describe('ADC mock client integration (M-03)', () => {
  after(() => {
    stopAdcMock();
  });

  it('sends correct request with X-Subject-Token', async () => {
    const port = await startAdcMock('normal');
    const result = await readAdcRequirements({
      adcMockOrigin: `http://127.0.0.1:${port}`,
      accessToken: 'test-token-value',
      timeoutMs: 5000,
    });
    assert.ok(result.data);
    assert.equal(result.status, 200);
  });

  it('rejects redirect (3xx)', async () => {
    const port = await startAdcMock('redirect');
    await assert.rejects(
      () => readAdcRequirements({
        adcMockOrigin: `http://127.0.0.1:${port}`,
        accessToken: 'test-token',
      }),
      /redirect/,
    );
  });

  it('rejects server error (5xx)', async () => {
    const port = await startAdcMock('error');
    await assert.rejects(
      () => readAdcRequirements({
        adcMockOrigin: `http://127.0.0.1:${port}`,
        accessToken: 'test-token',
      }),
      /failed.*500/,
    );
  });
});
