/**
 * Tests for the strict IPv4 loopback origin validator (H-02).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateLoopbackOrigin } from '../src/origin-validator.js';

describe('validateLoopbackOrigin (H-02)', () => {
  // ── Positive tests ──────────────────────────────────────────────────

  it('accepts http://127.0.0.1:4001', () => {
    const result = validateLoopbackOrigin('http://127.0.0.1:4001');
    assert.equal(result.origin, 'http://127.0.0.1:4001');
    assert.equal(result.port, 4001);
  });

  it('accepts http://127.0.0.1:9099', () => {
    const result = validateLoopbackOrigin('http://127.0.0.1:9099');
    assert.equal(result.origin, 'http://127.0.0.1:9099');
    assert.equal(result.port, 9099);
  });

  it('accepts http://127.0.0.1:80 (explicit port)', () => {
    const result = validateLoopbackOrigin('http://127.0.0.1:80');
    assert.equal(result.origin, 'http://127.0.0.1:80');
    assert.equal(result.port, 80);
  });

  // ── Scheme rejection ────────────────────────────────────────────────

  it('rejects https://127.0.0.1:4001', () => {
    assert.throws(
      () => validateLoopbackOrigin('https://127.0.0.1:4001'),
      /scheme.*http/,
    );
  });

  it('rejects ftp://127.0.0.1:4001', () => {
    assert.throws(
      () => validateLoopbackOrigin('ftp://127.0.0.1:4001'),
      /scheme.*http/,
    );
  });

  // ── Hostname rejection ──────────────────────────────────────────────

  it('rejects localhost', () => {
    assert.throws(
      () => validateLoopbackOrigin('http://localhost:4001'),
      /hostname.*127\.0\.0\.1/,
    );
  });

  it('rejects ::1', () => {
    assert.throws(
      () => validateLoopbackOrigin('http://[::1]:4001'),
      /hostname.*127\.0\.0\.1/,
    );
  });

  it('rejects 0.0.0.0', () => {
    assert.throws(
      () => validateLoopbackOrigin('http://0.0.0.0:4001'),
      /hostname.*127\.0\.0\.1/,
    );
  });

  it('rejects 127.0.0.2', () => {
    assert.throws(
      () => validateLoopbackOrigin('http://127.0.0.2:4001'),
      /hostname.*127\.0\.0\.1/,
    );
  });

  it('rejects 127.1 (short form)', () => {
    assert.throws(
      () => validateLoopbackOrigin('http://127.1:4001'),
      /hostname.*127\.0\.0\.1/,
    );
  });

  it('rejects decimal IP 2130706433 (127.0.0.1 as integer)', () => {
    assert.throws(
      () => validateLoopbackOrigin('http://2130706433:4001'),
      /hostname.*127\.0\.0\.1/,
    );
  });

  it('rejects hex IP 0x7f000001', () => {
    assert.throws(
      () => validateLoopbackOrigin('http://0x7f000001:4001'),
      /hostname.*127\.0\.0\.1/,
    );
  });

  it('rejects DNS name', () => {
    assert.throws(
      () => validateLoopbackOrigin('http://auth-service.internal:4001'),
      /hostname.*127\.0\.0\.1/,
    );
  });

  // ── Port validation ─────────────────────────────────────────────────

  it('rejects missing port (implicit default)', () => {
    assert.throws(
      () => validateLoopbackOrigin('http://127.0.0.1'),
      /hostname must be exactly/,
    );
  });

  it('rejects port 0', () => {
    assert.throws(
      () => validateLoopbackOrigin('http://127.0.0.1:0'),
      /port.*0/,
    );
  });

  it('rejects port 65536 (out of range)', () => {
    assert.throws(
      () => validateLoopbackOrigin('http://127.0.0.1:65536'),
      /unable to parse URL/,
    );
  });

  // ── Userinfo rejection ──────────────────────────────────────────────

  it('rejects username in URL (caught by hostname format check)', () => {
    assert.throws(
      () => validateLoopbackOrigin('http://user@127.0.0.1:4001'),
      /hostname must be exactly/,
    );
  });

  it('rejects username:password in URL (caught by hostname format check)', () => {
    assert.throws(
      () => validateLoopbackOrigin('http://user:pass@127.0.0.1:4001'),
      /hostname must be exactly/,
    );
  });

  // ── Path / query / fragment rejection ───────────────────────────────

  it('rejects path component', () => {
    assert.throws(
      () => validateLoopbackOrigin('http://127.0.0.1:4001/api/token'),
      /path component/,
    );
  });

  it('rejects query component', () => {
    assert.throws(
      () => validateLoopbackOrigin('http://127.0.0.1:4001?foo=bar'),
      /query component/,
    );
  });

  it('rejects fragment component', () => {
    assert.throws(
      () => validateLoopbackOrigin('http://127.0.0.1:4001#section'),
      /fragment component/,
    );
  });

  // ── Edge cases ──────────────────────────────────────────────────────

  it('rejects empty string', () => {
    assert.throws(
      () => validateLoopbackOrigin(''),
      /unable to parse/,
    );
  });

  it('rejects malformed URL', () => {
    assert.throws(
      () => validateLoopbackOrigin('not-a-url'),
      /unable to parse/,
    );
  });

  it('rejects origin with trailing slash (caught by trailing slash check)', () => {
    assert.throws(
      () => validateLoopbackOrigin('http://127.0.0.1:4001/'),
      /trailing slash/,
    );
  });
});
