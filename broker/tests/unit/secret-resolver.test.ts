/**
 * Secret Resolver Unit Tests
 *
 * Covers:
 * - Plain string passthrough
 * - env source resolution (via injectable resolver)
 * - file source resolution (via injectable resolver)
 * - exec source resolution (via injectable resolver)
 * - Error cases for each source
 * - isSecretRef type guard
 * - setSecretResolver injection works
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSecretInput, isSecretRef, setSecretResolver, SecretResolutionError } from '../../src/secret-resolver.js';
import type { SecretInput } from 'openclaw/plugin-sdk';

// ─── Mock Resolver for Tests ──────────────────────────────────────────────

/**
 * Test-only mock resolver that simulates the OpenClaw SDK resolution.
 * Sources: env → process.env, file → read file, exec → execute command.
 */
async function mockResolver(input: SecretInput): Promise<string> {
  if (typeof input === 'string') {
    return input;
  }

  const { source, id } = input;

  switch (source) {
    case 'env': {
      const value = process.env[id];
      if (value === undefined || value === null || value === '') {
        throw new SecretResolutionError(source, id, 'environment variable is not set or empty');
      }
      return value;
    }
    case 'file': {
      const { readFile } = await import('node:fs/promises');
      try {
        const content = await readFile(id, { encoding: 'utf-8' });
        return content.trimEnd();
      } catch (err: any) {
        throw new SecretResolutionError(source, id, err.message ?? String(err));
      }
    }
    case 'exec': {
      const { execSync } = await import('node:child_process');
      try {
        const stdout = execSync(id, {
          encoding: 'utf-8',
          timeout: 10_000,
          maxBuffer: 1024 * 1024,
        });
        return stdout.trimEnd();
      } catch (err: any) {
        throw new SecretResolutionError(source, id, err.message ?? String(err));
      }
    }
    default:
      throw new SecretResolutionError(source, id, `unsupported source: "${source}"`);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('SecretResolver', () => {
  before(() => {
    // Inject mock resolver for all tests
    setSecretResolver(mockResolver);
  });

  after(() => {
    // Reset to default SDK resolver
    setSecretResolver(null);
  });

  describe('env source', () => {
    after(() => {
      // Restore env after env source tests
      delete process.env['TEST_BROKER_SECRET'];
      delete process.env['TEST_NONEXISTENT_SECRET'];
      delete process.env['TEST_EMPTY_SECRET'];
    });

    it('resolves an existing env var', async () => {
      process.env['TEST_BROKER_SECRET'] = 'my-secret-value';
      const result = await resolveSecretInput({ source: 'env', provider: 'os', id: 'TEST_BROKER_SECRET' });
      assert.equal(result, 'my-secret-value');
    });

    it('throws if env var is not set', async () => {
      delete process.env['TEST_NONEXISTENT_SECRET'];
      await assert.rejects(
        () => resolveSecretInput({ source: 'env', provider: 'os', id: 'TEST_NONEXISTENT_SECRET' }),
        SecretResolutionError,
      );
    });

    it('throws if env var is empty string', async () => {
      process.env['TEST_EMPTY_SECRET'] = '';
      await assert.rejects(
        () => resolveSecretInput({ source: 'env', provider: 'os', id: 'TEST_EMPTY_SECRET' }),
        SecretResolutionError,
      );
    });
  });

  describe('file source', () => {
    it('reads from a file', async () => {
      const { writeFileSync, unlinkSync, mkdtempSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { tmpdir } = await import('node:os');

      const dir = mkdtempSync(join(tmpdir(), 'broker-test-'));
      const filePath = join(dir, 'secret.txt');
      writeFileSync(filePath, 'file-secret-value\n', 'utf-8');

      try {
        const result = await resolveSecretInput({ source: 'file', provider: 'fs', id: filePath });
        assert.equal(result, 'file-secret-value');
      } finally {
        unlinkSync(filePath);
      }
    });

    it('throws if file does not exist', async () => {
      await assert.rejects(
        () => resolveSecretInput({ source: 'file', provider: 'fs', id: '/nonexistent/path/secret.txt' }),
        SecretResolutionError,
      );
    });
  });

  describe('exec source', () => {
    it('executes a command and returns stdout', async () => {
      const result = await resolveSecretInput({ source: 'exec', provider: 'shell', id: 'echo my-exec-secret' });
      assert.equal(result, 'my-exec-secret');
    });

    it('throws if command fails', async () => {
      await assert.rejects(
        () => resolveSecretInput({ source: 'exec', provider: 'shell', id: 'exit 1' }),
        SecretResolutionError,
      );
    });
  });

  describe('resolveSecretInput', () => {
    it('passes through plain strings', async () => {
      const result = await resolveSecretInput('plain-string');
      assert.equal(result, 'plain-string');
    });

    it('resolves SecretRef inputs via mock', async () => {
      process.env['TEST_INPUT_SECRET'] = 'resolved-from-ref';
      const result = await resolveSecretInput({ source: 'env', provider: 'os', id: 'TEST_INPUT_SECRET' });
      assert.equal(result, 'resolved-from-ref');
      delete process.env['TEST_INPUT_SECRET'];
    });
  });

  describe('isSecretRef type guard', () => {
    it('returns true for valid SecretRef object', () => {
      assert.equal(isSecretRef({ source: 'env', provider: 'p', id: 'x' }), true);
    });

    it('returns false for plain string', () => {
      assert.equal(isSecretRef('plain'), false);
    });

    it('returns false for null', () => {
      assert.equal(isSecretRef(null), false);
    });

    it('returns false for object missing required fields', () => {
      assert.equal(isSecretRef({ source: 'env' }), false);
    });
  });

  describe('setSecretResolver injection', () => {
    it('injected resolver is used for resolution', async () => {
      // Temporarily inject a custom resolver
      const customResolver = async () => 'custom-resolved-value';
      setSecretResolver(customResolver);

      const result = await resolveSecretInput('anything');
      assert.equal(result, 'custom-resolved-value');

      // Reset
      setSecretResolver(null);
    });
  });
});
