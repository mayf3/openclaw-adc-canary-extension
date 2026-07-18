/**
 * Tests for the secure secret file reader.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readSecretFromFile } from '../src/secrets.js';

// ─── Helpers ──────────────────────────────────────────────────────────────

let tmpDir: string;

function tmpFile(name: string): string {
  return path.join(tmpDir, name);
}

function createSecret(value: string, name = 'secret.txt'): string {
  const filePath = tmpFile(name);
  fs.writeFileSync(filePath, value, 'utf-8');
  return filePath;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('readSecretFromFile', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-canary-secret-test-'));
    fs.chmodSync(tmpDir, 0o700);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads a plain text secret', () => {
    const filePath = createSecret('my-secret-value\n');
    const result = readSecretFromFile(filePath);
    assert.equal(result.secret, 'my-secret-value');
  });

  it('strips trailing newline (LF)', () => {
    const filePath = createSecret('secret-value\n');
    const result = readSecretFromFile(filePath);
    assert.equal(result.secret, 'secret-value');
  });

  it('strips trailing newline (CRLF)', () => {
    const filePath = createSecret('secret-value\r\n');
    const result = readSecretFromFile(filePath);
    assert.equal(result.secret, 'secret-value');
  });

  it('preserves internal whitespace', () => {
    const filePath = createSecret('  secret with spaces  \n');
    const result = readSecretFromFile(filePath);
    assert.equal(result.secret, '  secret with spaces  ');
  });

  it('rejects non-absolute path', () => {
    assert.throws(
      () => readSecretFromFile('relative/path/secret.txt'),
      /secret-file-path/,
    );
  });

  it('rejects missing file', () => {
    const missingPath = tmpFile('nonexistent.txt');
    assert.throws(
      () => readSecretFromFile(missingPath),
      /not found.*secret-file-path/,
    );
  });

  it('rejects empty file', () => {
    const filePath = createSecret('');
    assert.throws(
      () => readSecretFromFile(filePath),
      /empty.*secret-file-path/,
    );
  });

  it('masks the real path in error messages', () => {
    const missingPath = tmpFile('top-secret.txt');
    try {
      readSecretFromFile(missingPath);
      assert.fail('Should have thrown');
    } catch (err: any) {
      // The error should NOT contain the real path
      assert.ok(!err.message.includes(missingPath),
        `Error leaked path: "${missingPath}"`);
      assert.ok(err.message.includes('<secret-file-path>'),
        'Error should contain placeholder');
    }
  });
});
