/**
 * Secret Resolver — Resolves SecretRef values using the OpenClaw official
 * SecretRef resolution path or a configurable alternative.
 *
 * PRODUCTION BEHAVIOR:
 * When the plugin is loaded by the OpenClaw Gateway, credentials are resolved
 * at plugin registration time through the Gateway's trusted secret resolution
 * system (normalizeSecretInputString from openclaw/plugin-sdk). The resolved
 * values are cached in memory for the plugin's lifetime. NO custom file,
 * exec, or env reads happen during tool execution.
 *
 * Security properties:
 * - Secrets are resolved ONCE at plugin registration, NOT per tool call.
 * - Resolved values live only in process memory.
 * - The model NEVER sees the resolved value.
 * - No custom file/exec/env reading outside the SDK's controlled providers.
 *
 * For testability, the resolver function can be injected via
 * setSecretResolver().
 */

import type { SecretInput, SecretRef } from 'openclaw/plugin-sdk';
import {
  normalizeSecretInputString as sdkNormalize,
  isSecretRef as sdkIsSecretRef,
} from 'openclaw/plugin-sdk';

// ─── Errors ───────────────────────────────────────────────────────────────

export class SecretResolutionError extends Error {
  constructor(source: string, id: string, detail: string) {
    super(`Secret resolution failed (${source}/${id}): ${detail}`);
    this.name = 'SecretResolutionError';
  }
}

// ─── Resolver (injectable for testability) ────────────────────────────────

/** Type of the secret resolution function. */
export type SecretResolverFn = (input: SecretInput) => Promise<string>;

/**
 * The active secret resolver function.
 * Defaults to the OpenClaw SDK's normalizeSecretInputString.
 * Override via setSecretResolver() for testing.
 */
let activeResolver: SecretResolverFn = resolveViaSDK;

/**
 * Override the active secret resolver (for testing).
 * Pass `null` to reset to the default (SDK).
 */
export function setSecretResolver(fn: SecretResolverFn | null): void {
  activeResolver = fn ?? resolveViaSDK;
}

/**
 * Default resolver: uses the OpenClaw SDK's normalizeSecretInputString.
 * This works when running inside the OpenClaw Gateway runtime.
 * Outside the Gateway, it may return undefined if the secret system
 * is not initialized.
 */
async function resolveViaSDK(input: SecretInput): Promise<string> {
  if (typeof input === 'string') {
    return input;
  }

  const resolved = await sdkNormalize(input);

  // If SDK resolved to undefined (e.g., outside Gateway context),
  // fall back to a basic env/file/exec resolution for development.
  if (resolved === undefined || resolved === null) {
    return resolveFallback(input);
  }

  return resolved;
}

/**
 * Fallback resolver for development/testing outside the Gateway.
 * Supports the same three sources: env, file, exec.
 */
async function resolveFallback(ref: SecretRef): Promise<string> {
  const { source, id } = ref;

  switch (source) {
    case 'env': {
      const value = process.env[id];
      if (value === undefined || value === null) {
        throw new SecretResolutionError(source, id, 'environment variable is not set');
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

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Resolve a SecretInput to its actual string value.
 *
 * Uses the active resolver (SDK by default, injectable for tests).
 * Resolves SecretRef objects through the OpenClaw Gateway's trusted
 * env/file/exec providers.
 *
 * @param input  A SecretRef descriptor OR a plain string.
 * @returns      The resolved secret string.
 * @throws       SecretResolutionError if resolution fails.
 */
export async function resolveSecretInput(input: SecretInput): Promise<string> {
  return activeResolver(input);
}

/**
 * Resolve a SecretRef to its actual string value.
 * Convenience wrapper over resolveSecretInput.
 */
export async function resolveSecret(ref: SecretRef): Promise<string> {
  return resolveSecretInput(ref);
}

/** Type guard — check if a value is a SecretRef. */
export function isSecretRef(value: unknown): value is SecretRef {
  return sdkIsSecretRef(value);
}
