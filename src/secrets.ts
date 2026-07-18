/**
 * Secure secret file reader for the ADC Canary Extension.
 *
 * Reads the machine client secret from a canonical file path.
 * Requirements:
 *   - Only reads from the configured secret file path
 *   - Does NOT read from workspace .env, process.env, or CLI args
 *   - Rejects symlinks (safety check against path redirection)
 *   - Fail closed on missing file, permission error, or format error
 *   - Error messages mask the real path (replaced with <secret-file-path>)
 *   - Never writes secret to logs, stdout, stderr, or tool results
 *
 * The secret path itself is a deployment-time config value stored in
 * the immutable security config (not in tool parameters or workspace).
 */

import fs from 'node:fs';
import path from 'node:path';

/** Placeholder used to mask the real secret file path in error messages. */
const SECRET_PATH_PLACEHOLDER = '<secret-file-path>';

/** Maximum secret file size in bytes (64 KB). */
const MAX_SECRET_FILE_BYTES = 64 * 1024;

export interface ReadSecretResult {
  /** The raw secret string (trimmed of trailing newline). */
  secret: string;
}

/**
 * Read the machine client secret from a canonical file path.
 *
 * @param secretFilePath  Absolute path to the secret file.
 * @returns The secret string.
 * @throws Error if the file cannot be read, is a symlink, is too large,
 *         or has incorrect permissions. The real path is masked in the
 *         thrown error message.
 */
export function readSecretFromFile(secretFilePath: string): ReadSecretResult {
  const resolvedPath = path.resolve(secretFilePath);

  try {
    // ── 1. Check path is absolute ──────────────────────────────────────
    if (!path.isAbsolute(secretFilePath)) {
      throw new Error(`Secret file path must be absolute: ${SECRET_PATH_PLACEHOLDER}`);
    }

    // ── 2. Check file existence and type ───────────────────────────────
    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolvedPath);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new Error(`Secret file not found: ${SECRET_PATH_PLACEHOLDER}`);
      }
      if (err.code === 'EACCES') {
        throw new Error(`Secret file permission denied: ${SECRET_PATH_PLACEHOLDER}`);
      }
      throw new Error(`Secret file access error: ${SECRET_PATH_PLACEHOLDER}`);
    }

    // ── 3. Reject symlinks ─────────────────────────────────────────────
    if (stat.isSymbolicLink()) {
      throw new Error(`Secret file must not be a symlink: ${SECRET_PATH_PLACEHOLDER}`);
    }

    // ── 4. Must be a regular file ──────────────────────────────────────
    if (!stat.isFile()) {
      throw new Error(`Secret path is not a regular file: ${SECRET_PATH_PLACEHOLDER}`);
    }

    // ── 5. Check file size ─────────────────────────────────────────────
    if (stat.size > MAX_SECRET_FILE_BYTES) {
      throw new Error(`Secret file too large (max ${MAX_SECRET_FILE_BYTES} bytes): ${SECRET_PATH_PLACEHOLDER}`);
    }

    // ── 6. Read file contents ──────────────────────────────────────────
    let content: string;
    try {
      content = fs.readFileSync(resolvedPath, 'utf-8');
    } catch (err: any) {
      if (err.code === 'EACCES') {
        throw new Error(`Secret file permission denied: ${SECRET_PATH_PLACEHOLDER}`);
      }
      throw new Error(`Secret file read error: ${SECRET_PATH_PLACEHOLDER}`);
    }

    // ── 7. Trim trailing newline only (preserve other whitespace) ──────
    const trimmed = content.replace(/\r?\n$/, '');

    if (!trimmed) {
      throw new Error(`Secret file is empty: ${SECRET_PATH_PLACEHOLDER}`);
    }

    return { secret: trimmed };
  } catch (err) {
    // Mask the real path in all error messages
    if (err instanceof Error && err.message.includes(SECRET_PATH_PLACEHOLDER)) {
      throw err; // Already masked
    }
    if (err instanceof Error) {
      // Mask any leaked path
      const masked = err.message.replace(
        new RegExp(resolvedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
        SECRET_PATH_PLACEHOLDER,
      );
      throw new Error(masked);
    }
    throw err;
  }
}
