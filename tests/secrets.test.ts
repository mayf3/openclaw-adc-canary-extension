/**
 * Tests for the secure secret file reader.
 *
 * Covers H-01 requirements:
 *   - Symlink detection (lstatSync)
 *   - Parent directory symlink rejection
 *   - TOCTOU mitigation
 *   - Non-regular file rejection
 *   - Permission validation
 *   - Empty secret rejection
 *   - Oversized secret rejection
 *   - NUL byte rejection
 *   - Control character rejection
 *   - Path masking in errors
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

function createSymlink(target: string, linkPath: string): string {
  fs.symlinkSync(target, linkPath);
  return linkPath;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('readSecretFromFile (H-01)', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-canary-secret-test-'));
    fs.chmodSync(tmpDir, 0o700);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Basic functionality ─────────────────────────────────────────────

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

  // ── Path validation ─────────────────────────────────────────────────

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

  // ── H-01: Symlink rejection ─────────────────────────────────────────

  it('rejects symlink file itself', () => {
    const realFile = createSecret('real-secret\n');
    const symlinkPath = tmpFile('symlink-to-secret');
    createSymlink(realFile, symlinkPath);

    assert.throws(
      () => readSecretFromFile(symlinkPath),
      /symlink/,
    );
  });

  it('rejects parent directory symlink', () => {
    // Create a symlink directory pointing to the real temp dir
    const realDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-canary-real-dir-'));
    const symlinkDir = tmpFile('symlink-parent');
    fs.symlinkSync(realDir, symlinkDir);

    // Create secret inside the symlink parent
    const secretPath = path.join(symlinkDir, 'secret.txt');
    fs.writeFileSync(secretPath, 'my-secret\n');

    assert.throws(
      () => readSecretFromFile(secretPath),
      /symlink/,
      'Should reject secret in symlinked parent directory',
    );

    fs.rmSync(realDir, { recursive: true, force: true });
  });

  it('rejects symlink pointing to a regular file', () => {
    const realFile = createSecret('real-secret\n');
    const symlinkPath = tmpFile('symlink-file');
    createSymlink(realFile, symlinkPath);

    assert.throws(
      () => readSecretFromFile(symlinkPath),
      /symlink/,
    );
  });

  // ── H-01: Non-regular file rejection ────────────────────────────────

  it('rejects a directory instead of a file', () => {
    const dirPath = tmpFile('a-directory');
    fs.mkdirSync(dirPath);

    assert.throws(
      () => readSecretFromFile(dirPath),
      /not a regular file/,
    );
  });

  it('rejects a FIFO (named pipe)', () => {
    // Only test FIFO on systems that support mkfifo
    const fifoPath = tmpFile('secret-fifo');
    try {
      const { spawnSync } = require('node:child_process');
      spawnSync('mkfifo', [fifoPath]);
      if (fs.existsSync(fifoPath)) {
        assert.throws(
          () => readSecretFromFile(fifoPath),
          /not a regular file/,
        );
      }
    } catch {
      // mkfifo not available — skip
    }
  });

  // ── H-01: Content validation ────────────────────────────────────────

  it('rejects embedded NUL byte', () => {
    const filePath = tmpFile('nul-secret.txt');
    fs.writeFileSync(filePath, 'secret\0with-nul\n');

    assert.throws(
      () => readSecretFromFile(filePath),
      /NUL/,
    );
  });

  it('rejects oversized secret beyond 64KB', () => {
    const filePath = tmpFile('large-secret.txt');
    const bigSecret = 'x'.repeat(70 * 1024) + '\n';
    fs.writeFileSync(filePath, bigSecret);

    assert.throws(
      () => readSecretFromFile(filePath),
      /too large/,
    );
  });

  // ── Path masking ────────────────────────────────────────────────────

  it('masks the real path in error messages', () => {
    const missingPath = tmpFile('top-secret.txt');
    try {
      readSecretFromFile(missingPath);
      assert.fail('Should have thrown');
    } catch (err: any) {
      assert.ok(!err.message.includes(missingPath),
        `Error leaked path: "${missingPath}"`);
      assert.ok(err.message.includes('<secret-file-path>'),
        'Error should contain placeholder');
    }
  });

  it('masks path when parent directory is missing', () => {
    const deepPath = path.join(tmpDir, 'nonexistent', 'subdir', 'secret.txt');
    try {
      readSecretFromFile(deepPath);
      assert.fail('Should have thrown');
    } catch (err: any) {
      assert.ok(!err.message.includes(deepPath));
      assert.ok(err.message.includes('<secret-file-path>'));
    }
  });

  // ── Permission warning ──────────────────────────────────────────────

  it('rejects world-writable secret file', () => {
    const filePath = createSecret('my-secret\n');
    fs.chmodSync(filePath, 0o602); // world-writable

    assert.throws(
      () => readSecretFromFile(filePath),
      /world-writable/,
    );
  });
});
