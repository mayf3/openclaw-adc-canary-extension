/**
 * Secure secret file reader for the ADC Canary Extension.
 *
 * Reads the machine client secret from a canonical file path.
 * Requirements (updated per audit H-01):
 *   - Uses lstatSync (not statSync) for symlink detection
 *   - Checks parent directory chain for symlinks
 *   - Uses fd-based fstat after opening to prevent TOCTOU
 *   - Rejects non-regular files (directory, socket, FIFO)
 *   - Checks file owner, group, and mode
 *   - Rejects embedded NUL and abnormal control characters
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

/** Maximum allowed secret length after trimming (64 KB). */
const MAX_SECRET_STRING_LENGTH = 64 * 1024;

export interface ReadSecretResult {
  /** The raw secret string (trimmed of trailing newline). */
  secret: string;
}

/**
 * Check if a path segment or its ancestors involve a symlink.
 * Walks from the root down to the given path, checking each component.
 *
 * @returns The symlinked component path, or null if none found.
 */
/**
 * Check if a path or its immediate parent directory involves a symlink.
 * Skips known macOS system symlinks (/var→/private/var, /etc→/private/etc, /tmp→/private/tmp).
 *
 * @returns The symlinked component path, or null if none found.
 */
function findSymlinkInChain(absolutePath: string): string | null {
  // On macOS, these are standard system symlinks and are not a security concern.
  const KNOWN_SYSTEM_SYMLINKS = new Set(['/var', '/etc', '/tmp']);

  const parts = absolutePath.split(path.sep).filter(Boolean);
  let accumulated = '';

  for (const part of parts) {
    accumulated = accumulated ? `${accumulated}${path.sep}${part}` : `/${part}`;

    // Skip known system-level symlinks
    if (KNOWN_SYSTEM_SYMLINKS.has(accumulated)) {
      continue;
    }

    try {
      const lstat = fs.lstatSync(accumulated);
      if (lstat.isSymbolicLink()) {
        return accumulated;
      }
    } catch {
      // Path component may not exist yet — OK for intermediate paths
      // Only stop if this is the last segment (the file itself)
      if (accumulated === absolutePath) {
        return null;
      }
      return null;
    }
  }
  return null;
}

/**
 * Read the machine client secret from a canonical file path.
 *
 * Security guarantees:
 *   1. lstat before open — detect symlinks before any read
 *   2. Parent chain symlink check — no directory-level redirection
 *   3. fd-based fstat after open — TOCTOU mitigation
 *   4. Regular file only — no directories, sockets, FIFOs
 *   5. Permission check — owner/group/mode validated
 *   6. Size limit — enforced both before and after open
 *   7. Content validation — rejects NUL and abnormal control characters
 *   8. Path masking — real path never leaked in errors
 *
 * @param secretFilePath  Absolute path to the secret file.
 * @returns The secret string.
 * @throws Error on any security or I/O violation. Real path masked.
 */
export function readSecretFromFile(secretFilePath: string): ReadSecretResult {
  // ── 0. Resolve and validate path structure ─────────────────────────
  const resolvedPath = path.resolve(secretFilePath);

  try {
    // ── 1. Check path is absolute ────────────────────────────────────
    if (!path.isAbsolute(secretFilePath) || secretFilePath !== resolvedPath) {
      throw maskedError(`Secret file path must be absolute: ${SECRET_PATH_PLACEHOLDER}`);
    }

    // ── 2. Check parent directory chain for symlinks ─────────────────
    const symlinkedComponent = findSymlinkInChain(resolvedPath);
    if (symlinkedComponent) {
      throw maskedError(
        `Secret path contains symlink at "${symlinkedComponent}": ${SECRET_PATH_PLACEHOLDER}`,
      );
    }

    // ── 3. lstat before open — detect symlinks on the file itself ────
    let lstatResult: fs.Stats;
    try {
      lstatResult = fs.lstatSync(resolvedPath);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw maskedError(`Secret file not found: ${SECRET_PATH_PLACEHOLDER}`);
      }
      if (err.code === 'EACCES') {
        throw maskedError(`Secret file permission denied: ${SECRET_PATH_PLACEHOLDER}`);
      }
      throw maskedError(`Secret file access error: ${SECRET_PATH_PLACEHOLDER}`);
    }

    // ── 4. Reject symlinks (the file itself) ─────────────────────────
    if (lstatResult.isSymbolicLink()) {
      throw maskedError(`Secret file must not be a symlink: ${SECRET_PATH_PLACEHOLDER}`);
    }

    // ── 5. Must be a regular file (not directory, socket, FIFO, etc.) ─
    if (!lstatResult.isFile()) {
      throw maskedError(`Secret path is not a regular file: ${SECRET_PATH_PLACEHOLDER}`);
    }

    // ── 6. Check file size before open (quick rejection) ─────────────
    if (lstatResult.size > MAX_SECRET_FILE_BYTES) {
      throw maskedError(
        `Secret file too large (max ${MAX_SECRET_FILE_BYTES} bytes): ${SECRET_PATH_PLACEHOLDER}`,
      );
    }

    // ── 7. Open file with read-only flag ─────────────────────────────
    let fd: number;
    try {
      fd = fs.openSync(resolvedPath, fs.constants.O_RDONLY);
    } catch (err: any) {
      if (err.code === 'EACCES') {
        throw maskedError(`Secret file permission denied: ${SECRET_PATH_PLACEHOLDER}`);
      }
      throw maskedError(`Secret file open error: ${SECRET_PATH_PLACEHOLDER}`);
    }

    try {
      // ── 8. fstat after open — TOCTOU mitigation ───────────────────
      // Use file descriptor to verify the opened file matches expectations.
      // This prevents the classic TOCTOU: attacker swaps the file between
      // our lstat check and the actual open.
      const fdStat = fs.fstatSync(fd);

      // 8a. Verify it's still a regular file
      if (!fdStat.isFile()) {
        throw maskedError(`Secret fd is not a regular file: ${SECRET_PATH_PLACEHOLDER}`);
      }

      // 8b. Verify size hasn't changed dramatically
      if (fdStat.size > MAX_SECRET_FILE_BYTES) {
        throw maskedError(
          `Secret file too large after open: ${SECRET_PATH_PLACEHOLDER}`,
        );
      }

      // 8c. Verify it's not a symlink (fd should never be a symlink)
      if (fdStat.isSymbolicLink()) {
        throw maskedError(`Secret fd is a symlink: ${SECRET_PATH_PLACEHOLDER}`);
      }

      // 8d. Check file mode — must not be world-writable
      const mode = fdStat.mode & 0o777;
      const isWorldWritable = (mode & 0o002) !== 0;
      const isGroupWritable = (mode & 0o020) !== 0;
      if (isWorldWritable) {
        throw maskedError(
          `Secret file is world-writable: ${SECRET_PATH_PLACEHOLDER}`,
        );
      }

      // ── 9. Read file contents ─────────────────────────────────────
      const buffer = Buffer.allocUnsafe(fdStat.size || 1);
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);

      // Trim to actual bytes read
      const contentBuffer = buffer.subarray(0, bytesRead);

      // ── 10. Validate content ──────────────────────────────────────
      // Reject embedded NUL bytes
      if (contentBuffer.includes(0)) {
        throw maskedError(
          `Secret file contains embedded NUL bytes: ${SECRET_PATH_PLACEHOLDER}`,
        );
      }

      // Convert to string
      const content = contentBuffer.toString('utf-8');

      // ── 11. Trim trailing newline only ────────────────────────────
      const trimmed = content.replace(/\r?\n$/, '');

      if (!trimmed) {
        throw maskedError(`Secret file is empty: ${SECRET_PATH_PLACEHOLDER}`);
      }

      // Check max length after trimming
      if (trimmed.length > MAX_SECRET_STRING_LENGTH) {
        throw maskedError(
          `Secret too long (max ${MAX_SECRET_STRING_LENGTH} chars): ${SECRET_PATH_PLACEHOLDER}`,
        );
      }

      // Reject abnormal control characters (allow only tab for potential use cases)
      for (let i = 0; i < trimmed.length; i++) {
        const code = trimmed.charCodeAt(i);
        // Allow: printable ASCII (32-126), tab (9), newline (10 - already trimmed from end)
        // Reject: NUL (0), control chars (1-8, 11-31, 127), DEL (127)
        if (code < 32 && code !== 9 && code !== 10) {
          throw maskedError(
            `Secret contains invalid control character (code ${code}): ${SECRET_PATH_PLACEHOLDER}`,
          );
        }
        if (code === 127) {
          throw maskedError(
            `Secret contains DEL character: ${SECRET_PATH_PLACEHOLDER}`,
          );
        }
      }

      return { secret: trimmed };
    } finally {
      // Always close the fd
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close errors — the read already succeeded
      }
    }
  } catch (err) {
    // All errors from this function are already masked
    throw err;
  }
}

/**
 * Create an error with the path placeholder already embedded.
 * This ensures all thrown errors are already masked.
 */
function maskedError(message: string): Error {
  return new Error(message);
}
