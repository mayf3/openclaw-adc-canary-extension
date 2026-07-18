# OpenClaw ADC Canary Extension V0 — Independent Audit Report

> **Status**: `OPENCLAW_ADC_CANARY_EXTENSION_V0_AUDIT_BLOCKED`
> **Date**: 2026-07-18
> **Auditor Role**: Independent Audit Agent
> **Audit Scope**: PR-E0A — Code, Test, and Script Audit (no privileged OS execution)

---

## 0. Auditor's Report Summary

| Metric | Value |
|--------|-------|
| `BLOCKER_FINDINGS` | 0 |
| `HIGH_FINDINGS` | 2 |
| `NON_BLOCKING_FINDINGS` | 6 |
| `PRIVILEGED_E2E_OPERATOR_RUN_ALLOWED` | **no** |
| `MERGE_ALLOWED` | **no** |
| `PR_E1_IMPLEMENTATION_ALLOWED` | **no** |
| `PRODUCTION_DEPLOYMENT_ALLOWED` | **no** |
| `REAL_PROVISIONING_ALLOWED` | **no** |

**Final Determination**: `OPENCLAW_ADC_CANARY_EXTENSION_V0_AUDIT_BLOCKED`

Two HIGH findings must be resolved before privileged E2E execution can be authorized. Six MEDIUM findings should also be addressed.

---

## 1. Git Boundary Freeze

### Execution

```bash
git status --short
# (empty — clean)
git branch --show-current
# main
git rev-parse HEAD
# bbcf14db29c147ecb211f22a08e15a18de089087
git rev-parse HEAD^{tree}
# 4af7c0bf86197f5a27ae01053e22cbdcd2313a39
git log --oneline --graph --all --decorate
# * bbcf14d (HEAD -> main) feat(canary): Phase 4 - security tests + implementation report
# * 58fa212 feat(canary): Phase 2-3 - full tool implementation, E2E harness
# * 854fc3b feat(canary): Phase 0 - extension skeleton with probe tool
git show --stat --oneline 854fc3b
# 10 files changed, 455 insertions(+)
git show --stat --oneline 58fa212
# 13 files changed, 1948 insertions(+), 5 deletions(-)
git show --stat --oneline bbcf14d
# 1 file changed, 320 insertions(+)
```

### Verification

| Check | Result |
|-------|--------|
| `AUDIT_HEAD_SHA` | `bbcf14db29c147ecb211f22a08e15a18de089087` |
| `AUDIT_TREE_SHA` | `4af7c0bf86197f5a27ae01053e22cbdcd2313a39` |
| `WORKTREE_CLEAN` | true |
| `COMMIT_RANGE_ISOLATED` | true |
| `UNTRACKED_RUNTIME_DEPENDENCY` | none |

### Commit-level details

| Commit | SHA | Tree SHA | Description |
|--------|-----|----------|-------------|
| Phase 0 | `854fc3b12cdef93d8cf07c6b40c4df1801f88893` | `ff9ddd4c2cfdf6ff3fed6bb22d7756d8e1c38c8d` | Skeleton + probe tool |
| Phase 2-3 | `58fa212d1248a07de7ded0bf0e584bf5915c1372` | `8eb5970f6f3d93981a39227f55b524616875227e` | Full tool + E2E harness |
| Phase 4 | `bbcf14db29c147ecb211f22a08e15a18de089087` | `4af7c0bf86197f5a27ae01053e22cbdcd2313a39` | Security tests + report |

### Git Integrity Confirmations

1. ✅ Worktree is clean — no uncommitted files.
2. ✅ All three commits have complete SHA and Tree SHA recorded.
3. ⚠️ `dist/` and `node_modules/` are present on disk but correctly excluded by `.gitignore`.
4. ✅ No untracked secrets, configs, or credentials.
5. ✅ Three commits are cohesive — each builds on the previous.
6. ✅ No modifications to `auth-service`, `ADC`, or core `OpenClaw` workspaces.
7. ✅ Reported modified file list is accurate and complete.
8. ✅ No Git submodules, absolute path dependencies, or uncommitted local dependencies.

---

## 2. Extension Package & Loading Boundary

| Check | Result |
|-------|--------|
| `EXTENSION_PACKAGE_VALID` | false (see findings) |
| `AUTH_SERVICE_INTERNAL_CODE_DEPENDENCY` | false |
| `OPENCLAW_CORE_CHANGE_REQUIRED` | false |
| `REGISTER_TOOL_PATH_VALID` | true |
| `PROBE_MODE_SECURITY_BOUNDARY_SAFE` | true |

### Inspection Results

- **Plugin Manifest** (`openclaw.plugin.json`): Correct. ID `openclaw-adc-canary`, name `ADC Canary Extension (V0)`, configSchema has `additionalProperties: false`.
- **No auth-service imports**: Extension imports only `@sinclair/typebox` and `node:fs`, `node:path`. No relative paths into `auth-service`.
- **No OpenClaw core modifications**: Extension lives in independent repo.
- **Tool registered via factory pattern**: `api.registerTool()` with factory closure capturing `context.agentId`.
- **Probe mode hardcoded**: `const probeMode = true;` in `src/index.ts:26` — probe/full mode controlled by code change, not model parameters.

### 🔴 FINDING H-02: `package.json` openclaw.extensions path regression

| Field | Phase 0 (correct) | Phase 2-3 (broken) |
|-------|-------------------|-------------------|
| `openclaw.extensions` | `["./dist/index.js"]` | `["./index.js"]` |

The compiled output lands in `dist/index.js` (tsconfig: `outDir: dist`, `rootDir: src`). The file `./index.js` does NOT exist at the workspace root. Phase 0 had the correct path.

**Risk**: If OpenClaw uses `package.json` `openclaw.extensions` for auto-discovery (rather than `openclaw.plugin.json`), the extension fails to load. The setup script mitigates this by copying `dist/*` directly (flattening the path), but workspace-level loading is broken.

**Severity**: **HIGH** — regression from correct Phase 0 behavior; would block extension loading in certain OpenClaw configurations.

---

## 3. Artifact Integrity & Digest

| Check | Result |
|-------|--------|
| `EXTENSION_ARTIFACT_MANIFEST_COMPLETE` | pending (requires privileged execution) |
| `EXTENSION_ARTIFACT_DIGEST_COMPLETE` | false (see finding) |
| `DEVELOPMENT_WORKTREE_LOADED_AT_RUNTIME` | cannot verify without runtime access |
| `LEGACY_USER_CAN_MODIFY_LOADED_EXTENSION` | false (by script design) |
| `CANARY_RUNTIME_CAN_MODIFY_LOADED_EXTENSION` | false (by script design) |

### Findings

- The artifact manifest and SHA256SUMS are generated by `scripts/setup-canary.sh` which requires `sudo`. These were not executed during this audit.
- The report claims `EXTENSION_ARTIFACT_DIGEST = e57bf060bb63116a... (index.js)` — a single-file digest for `index.js`. The audit spec requires full artifact coverage (manifest, metadata, all `dist` modules, dependencies). The setup script does generate per-file SHA256 via `shasum -a 256 *.*`, which covers all files. However, this cannot be verified without privileged execution.
- The report's claimed digest only covers `index.js`, not the full artifact bundle. This falls short of the spec requirement for complete digest coverage.

---

## 4. Canary User Creation & Privilege (Static Audit)

| Check | Result |
|-------|--------|
| `CANARY_USER_IS_ADMIN` | false (by script design) |
| `CANARY_USER_HAS_SUDO` | false (by script design) |
| `CANARY_PASSWORD_EXPOSED_IN_PROCESS_ARGS` | false |
| `EXISTING_USER_OVERWRITE_BLOCKED` | true |
| `CLEANUP_USER_DELETION_SCOPED` | true (with caveat) |

### Analysis

- **User creation**: Uses `dscl . -create` (not `sysadminctl`), so no password on command line. Password set to `*` (disabled). Authentication authority set to `DisabledUsers`. Shell set to `/usr/bin/false`. All correct.
- **Existing user check**: `dscl . -list /Users | grep -q "^${CANARY_USER}$"` — if user already exists, script prints message and skips creation. **Does not modify existing user.** Correct.
- **No admin**: Script verifies user not in admin group after creation; explicitly removes if present.
- **Cleanup scope**: Deletes `"/Users/${CANARY_USER}"` via `dscl . -delete`. However, the script accepts the username as `$1` without validation that it matches the expected canary pattern. This could potentially delete an unintended user if the wrong argument is provided.

### Finding M-05: Cleanup script accepts arbitrary user argument

```bash
# cleanup-canary.sh line 10
CANARY_USER="${1:-oc-canary-runtime}"
```

No validation that the argument matches the expected canary user pattern. If run as `sudo scripts/cleanup-canary.sh _www`, it would attempt to delete `_www`. The `dscl` delete is scoped to `/Users/` but this is still risky.

**Severity**: **MEDIUM** — requires operator error with sudo to trigger.

---

## 5. Secret Files & Config Permissions (Static Audit)

| Check | Result |
|-------|--------|
| `SECRET_IN_WORKSPACE` | false |
| `SECRET_IN_PROCESS_ENV` | false |
| `CANARY_RUNTIME_CAN_MODIFY_SECRET` | false (by permissions) |
| `LEGACY_USER_CAN_READ_SECRET` | false (by permissions) |
| `SECURITY_CONFIG_IMMUTABLE_TO_RUNTIME` | true (by permissions) |
| `SYMLINK_ATTACK_BLOCKED` | **false** (see HIGH finding) |
| `SECRET_ERROR_PATH_REDACTED` | true |

### Analysis

- **Secret not in workspace**: Secret is only written to `/private/etc/oc-canary/secrets/` by the setup script.
- **Secret not in process.env**: The code reads from file only, never from environment variables.
- **Permissions**: Script sets `root:oc-canary` ownership, mode 440 (secret) and 750 (directory). Legacy user cannot read/modify.
- **Config file**: `root:wheel` ownership, mode 640. Neither canary runtime nor legacy user can modify.
- **Path masking**: Error messages in `secrets.ts` correctly replace the real path with `<secret-file-path>`. ✅
- **Empty file rejection**: ✅
- **Size limit**: 64KB cap enforced. ✅
- **Trailing newline trimmed**: ✅

### 🔴 FINDING H-01: Symlink detection broken in secrets.ts

```typescript
// src/secrets.ts lines 52-66
stat = fs.statSync(resolvedPath);     // ← FOLLOWS symlinks!
// ...
if (stat.isSymbolicLink()) {           // ← NEVER true after statSync
    throw new Error(`Secret file must not be a symlink: ${SECRET_PATH_PLACEHOLDER}`);
}
```

`fs.statSync()` follows symlinks by default, returning the target file's stats. `isSymbolicLink()` on the result is **always false**. This means symlink detection is completely non-functional — it provides a false sense of security.

The correct API is `fs.lstatSync()` which does NOT follow symlinks.

**Impact**: If an attacker gains write access to the secrets directory (or if the path configuration points to an attacker-writable location), a symlink attack redirecting the secret file to another file would go undetected. The code would read the substituted file's content as the client secret.

**Mitigation**: On the deployed system, the secrets directory is owned by `root:oc-canary` with mode 750, so only root can create files there. However, the code's guarantee is broken.

**Severity**: **HIGH** — security boundary failure; false security guarantee.

**Fix**: Replace `fs.statSync()` with `fs.lstatSync()` on line 52.

### Finding M-04: Predictable temp file in setup script

```bash
cat > /tmp/oc-canary-config.json << 'CONFIGEOF'
...
CONFIGEOF
sudo mv /tmp/oc-canary-config.json "${CONFIG_FILE}"
```

The temp file path `/tmp/oc-canary-config.json` is predictable. A local attacker with access to `/tmp/` could create a symlink at this path before the script runs, redirecting the `sudo mv` to overwrite an arbitrary file.

**Severity**: **MEDIUM** — requires local access; setup script requires sudo so operator has elevated privileges.

---

## 6. Direct Token Contract

| Check | Result |
|-------|--------|
| `AUTH_SERVICE_CONTRACT_SOURCE` | `3af27e7c5fddab7e5747d7c945e06db8faa78da9` (auth-service main) |
| `DIRECT_TOKEN_REQUEST_CONTRACT_CORRECT` | true |
| `DIRECT_TOKEN_PROFILE_RS256` | true |
| `ARBITRARY_SUBJECT_FIELD_SENT` | false |
| `REFRESH_TOKEN_REJECTED` | true |
| `FAILURE_FALLBACK_POLICY` | FAIL_CLOSED |

### Contract Implementation

The extension correctly implements the verified Direct Token contract:

| Field | Contract | Implementation |
|-------|----------|----------------|
| Endpoint | `POST /oauth/token` | `authServiceOrigin + "/oauth/token"` |
| Auth method | `Authorization: Basic base64(client_id:client_secret)` | Line 94, 112 |
| Grant type | `client_credentials` | Line 98 |
| Resource | `svc-workflow` (maps to JWT `aud`) | Line 109 |
| Scope | `workflow.read` | Line 110 |
| Signing | RS256 + kid (resource=svc-workflow) | Contract verified in auth-service |
| TTL | 600s (capped 900) | Not validated by client (server-side) |
| Refresh token | Not returned for client_credentials | Rejected if present (line 170-172) |
| Token type | `Bearer` | Validated (line 160-163) |

### Additional Security Checks

- ✅ No arbitrary subject field sent — only hardcoded `clientId` in Basic auth.
- ✅ Token never returned in tool results.
- ✅ Non-2xx responses fail closed (line 121-146).
- ✅ Malformed JSON response fails closed (line 152-154).
- ✅ Timeout bounded at 10s (line 51).
- ✅ No HS256 fallback — only one signing profile.
- ✅ No email/password fallback.
- ✅ No ADC JWT fallback.
- ✅ No static workflow token fallback.
- ✅ Extension does not parse or trust token payload.

---

## 7. Trusted Agent Binding

| Check | Result |
|-------|--------|
| `CONTEXT_AGENT_ID_SOURCE` | `src/tool.ts` — `ctx.agentId` from Gateway session context |
| `AGENT_MISMATCH_CHECK_PRECEDES_SECRET_READ` | true |
| `AGENT_MISMATCH_CHECK_PRECEDES_NETWORK` | true |
| `SHARED_MACHINE_CLIENT_USED` | false |
| `ARBITRARY_AGENT_SELECTION_ALLOWED` | false |

### Analysis

- **Agent ID source**: `context.agentId` from `OpenClawPluginToolContext`, captured in factory closure at registration time not controlled by model parameters. ✅
- **Tool parameters**: Empty schema — no `agentId`, `clientId`, or identity field in parameters. ✅
- **ExpectedAgentId**: From deployment config (`CanaryConfig.expectedAgentId`), not from workspace or model. ✅
- **Mismatch handling**: `AgentBindingError` thrown before any secret read or network call. ✅
- **No default fallback**: Matching logic is strict — `!==` comparison. ✅
- **Session reuse**: Each session has its own Gateway context; agentId is per-session. ✅
- **MachineClient ID**: Fixed in deployment config — single value, no mapping table. ✅
- **No shared client**: Single `machineClientId` in config. ✅
- **Tool result**: Details do not expose canonical Principal ID or token metadata. ✅

---

## 8. Tool Schema & Return Value

| Check | Result |
|-------|--------|
| `TOOL_SCHEMA_FIXED` | true |
| `ADDITIONAL_PROPERTIES_REJECTED` | true (by TypeBox schema) |
| `MODEL_CAN_SELECT_SECURITY_CONFIG` | false |
| `TOOL_RESULT_LEAK_FREE` | true |
| `ADC_RESPONSE_BOUNDED` | true |

### Schema Verification

```typescript
export const AdcWorkflowReadSchema = Type.Object(
  {},
  { additionalProperties: false },
);
```

- ✅ Empty object schema — no parameters accepted.
- ✅ `additionalProperties: false` — unknown fields rejected by TypeBox validation.
- ✅ No URL, path, method, header, scope, workspace, or identity fields.
- ✅ Model cannot switch probe/full mode (hardcoded in `index.ts`).
- ✅ Return value contains only `{ status, data }` — no tokens, secrets, or paths.
- ✅ Error messages properly redact file paths.

### Probe Mode Return Value

```json
{
  "status": "probe_ok",
  "agentId": "canary-agent",
  "tool": "adc_workflow_read",
  "mode": "probe",
  "message": "Tool registration and agent identity verified."
}
```

No secrets, no tokens, no configuration paths. ✅

---

## 9. Fixed Network Target

| Check | Result |
|-------|--------|
| `CANARY_NETWORK_MODE` | `loopback_http` |
| `AUTH_SERVICE_BIND_LOOPBACK_ONLY` | true (code validates) |
| `ADC_MOCK_BIND_LOOPBACK_ONLY` | true (code validates) |
| `PROXY_REDIRECTION_BLOCKED` | partial (see finding) |
| `REDIRECT_DISABLED` | true (`redirect: 'manual'`) |
| `TLS_VERIFICATION_TESTED` | false (loopback HTTP, not required) |

### 🔴 FINDING H-02: localhost accepted alongside 127.0.0.1

Both `auth-service-client.ts` and `adc-mock-client.ts` accept `localhost` as well as `127.0.0.1`:

```typescript
// auth-service-client.ts:86, adc-mock-client.ts:68
if (baseUrl.hostname !== '127.0.0.1' && baseUrl.hostname !== 'localhost') {
    throw new Error('...origin must be loopback (127.0.0.1 or localhost)');
}
```

On macOS, `localhost` can resolve to `::1` (IPv6 loopback) in addition to `127.0.0.1`. The audit spec requires:

> 1. 仅接受精确`127.0.0.1`。
> 2. 不接受`localhost`或DNS名称。

While both resolve to loopback on a default system, accepting DNS names departs from the strict spec requirement and creates a small but unnecessary attack surface.

**Severity**: **HIGH** — clear spec violation; could allow DNS rebinding or IPv6 bypass in modified environments.

**Fix**: Remove `localhost` from the accepted hostname list; validate only `127.0.0.1`.

### Finding M-06: No explicit proxy protection

The `fetch()` calls in both clients do not explicitly disable proxy environment variables (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `ALL_PROXY`). Node.js's built-in `fetch` (undici-based) does not automatically use proxy env vars, but the code should explicitly set `NO_PROXY: '*'` or use an agent that prevents proxy resolution to be defensive.

**Severity**: **MEDIUM** — mitigated by default Node.js behavior, but not explicit.

### Additional Checks

- ✅ Port is from deployment config, not model-controllable.
- ✅ Redirection disabled: `redirect: 'manual'` on all `fetch()` calls.
- ✅ 3xx responses fail closed.
- ✅ No SSH/curl usage.
- ✅ No `verify: false` (TLS is N/A for loopback HTTP).
- ✅ Request timeout bounded at 10s.
- ✅ No automatic retry of write operations; GET retry not implemented (no retry logic present).
- ✅ auth-service failure does not fall back to ADC Mock.

---

## 10. ADC Mock Security

| Check | Result |
|-------|--------|
| `ADC_MOCK_LOOPBACK_ONLY` | true |
| `DUPLICATE_SUBJECT_HEADER_REJECTED` | true |
| `ADC_MOCK_TOKEN_PERSISTED` | false |
| `ADC_MOCK_TOKEN_LOGGED` | false |
| `ADC_MOCK_HAS_SIDE_EFFECTS` | false |

### Verification

- ✅ Listens only on `127.0.0.1` (line 119).
- ✅ Only accepts `GET /api/requirements/mine` — other methods/paths rejected.
- ✅ `Authorization` header rejected (line 59-64).
- ✅ Duplicate `X-Subject-Token` detected via `rawHeaders` array (lines 69-88).
- ✅ Token in query string rejected (lines 91-99).
- ✅ Token not written to logs or persisted.
- ✅ Token not parsed or validated as JWT.
- ✅ No database or file writes.
- ✅ Returning fixed test response only.
- ✅ Port conflict: process crashes on port conflict (`EADDRINUSE`), no fallback.

### Weakness

- The mock does not check for token in `Cookie` header. However, the client only sends the token via `X-Subject-Token` header, so this is low risk.

---

## 11. Shell Script Injection & Misuse

| Check | Result |
|-------|--------|
| `SHELL_COMMAND_INJECTION_BLOCKED` | true |
| `CLEANUP_PATH_SCOPED` | true (with caveat) |
| `LEGACY_GATEWAY_KILL_RISK` | false |
| `CLEANUP_IDEMPOTENT` | true (with caveat) |

### Script Quality

- All scripts use `set -euo pipefail`. ✅
- All variables properly quoted. ✅
- `rm -rf` uses hardcoded absolute paths only. ✅
- No `eval` usage. ✅
- No sourcing of untrusted files. ✅
- PID management uses `$!` variable (not `pkill`). ✅
- Cleanup does not kill Legacy Gateway processes. ✅
- `sudo` usage is explicit and scoped. ✅

### Finding M-05: Cleanup script accepts user argument without validation

Already documented in Section 4. The `cleanup-canary.sh` script's `CANARY_USER` parameter from `$1` could cause deletion of unintended user records.

### Finding M-04: Predictable temp file

Already documented in Section 5. The `/tmp/oc-canary-config.json` path is predictable and susceptible to symlink attacks.

---

## 12. Test Results (Non-Privileged Execution)

| Test Suite | Result |
|------------|--------|
| Build (`tsc`) | ✅ Pass |
| TypeCheck (`tsc --noEmit`) | ✅ Pass |
| Unit Tests (probe.test.ts) | 7/7 Pass ✅ |
| Unit Tests (secrets.test.ts) | 8/8 Pass ✅ |
| **Total** | **15/15 Pass** ✅ |

### Metrics

| Metric | Value |
|--------|-------|
| `EXECUTED_UNIT_TEST_COUNT` | 15 |
| `EXECUTED_NON_PRIVILEGED_INTEGRATION_COUNT` | 0 |
| `DOCUMENTED_FUTURE_SECURITY_TEST_COUNT` | 42 (documented in matrix, not executable) |
| `TESTS_COVER_REAL_PLUGIN_REGISTRATION` | false (tests use factory pattern directly) |
| `TESTS_DIRECTLY_CALL_EXECUTE_ONLY` | true |

### Finding M-03: No integration/HTTP tests

Critical components (`auth-service-client.ts`, `adc-mock-client.ts`) have zero test coverage. Only `secrets.ts` and the tool factory (`tool.ts` probe mode) are tested. The HTTP clients handle token acquisition and ADC communication — the core security boundary — but are entirely untested.

**Severity**: **MEDIUM** — core security components lack automated verification.

### Finding M-02: `npm test` command broken

```
> npm test
> node --test tests/*.test.ts
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/tool.js'
```

The configured `npm test` script fails because Node.js cannot resolve `.ts` imports with `.js` extension in test files. Tests only pass with `npx tsx --test tests/*.test.ts`.

The `tsx` package is in devDependencies but not wired into the test command. The report claims 15 passing tests but does not disclose that the configured test command is broken.

**Severity**: **MEDIUM** — CI/CD pipeline would report false failures; test infrastructure unreliable.

---

## 13. Probe Verification Evidence

The report claims the following probe results, which this audit accepts based on code analysis:

| Check | Auditor Verdict |
|-------|-----------------|
| `PROBE_EXTENSION_LOADED` | **cannot independently verify** without Gateway runtime |
| `PROBE_TOOL_REGISTERED` | **cannot independently verify** without Gateway runtime |
| `PROBE_REAL_GATEWAY_SESSION_USED` | **cannot independently verify** without Gateway runtime |
| `PROBE_REAL_TOOL_INVOCATION_USED` | **cannot independently verify** without Gateway runtime |
| `PROBE_SECRET_READ_OCCURRED` | false (probe mode code path verified) |
| `PROBE_NETWORK_OCCURRED` | false (probe mode code path verified) |

### Code-Level Verification

By examining `src/tool.ts`:
- Probe mode (`probeMode = true`) returns early at line 75-98, before any `readSecretFromFile`, `requestDirectToken`, or `readAdcRequirements` call.
- The `src/index.ts` hardcodes `const probeMode = true` (line 26).
- The report's log evidence shows the tool was registered in probe mode.

While I cannot run the Gateway runtime during this audit, the code paths are clear: probe mode does not read secrets or make network calls. The log evidence in the report is consistent with the code.

---

## 14. Leak Scan

| Check | Result |
|-------|--------|
| `TOKEN_SECRET_LEAK_SCAN_PASS` | true |
| `GIT_HISTORY_CONTAINS_SECRET` | false |
| `REPORT_CONTAINS_SECRET` | false |
| `PRIVATE_KEY_TRACKED` | false |

### Scan Results

- No JWT tokens (`eyJ*`) in any commit.
- No private keys (`-----BEGIN`) in any commit.
- No actual token values in source code (field names only).
- The implementation report references field names and contract specs, not actual secrets.
- No `.env` files tracked (`.env` in `.gitignore`).
- No shell history committed.
- No temporary database files tracked.
- `.gitignore` covers `node_modules/`, `dist/`, `.env`, `*.log`, `.DS_Store` — adequate.

---

## 15. Implementation Code Completeness

| Dimension | Status |
|-----------|--------|
| `IMPLEMENTATION_CODE_COMPLETE` | true |
| `UNIT_TESTS_COMPLETE` | true (with caveats) |
| `PRIVILEGED_OS_SETUP_EXECUTED` | not_executed |
| `OS_ISOLATION_DYNAMIC_TEST_PASS` | not_executed |
| `REAL_GATEWAY_E2E_COMPLETE` | false |
| `TEMPORARY_ASSET_CLEANUP_COMPLETE` | not_executed |
| `PR_E0A_ACCEPTANCE_COMPLETE` | false |

### Code Completeness

All seven phases claimed in the report are implemented in code:
1. ✅ **Phase -1**: Auth-service contract verification (documented)
2. ✅ **Phase 0**: Extension skeleton + probe tool
3. ✅ **Phase 1A**: OS isolation scripts (setup, verify, cleanup)
4. ✅ **Phase 1B**: Probe unit tests
5. ✅ **Phase 2**: Secret file reader with path masking
6. ✅ **Phase 3**: Direct Token acquisition (auth-service client)
7. ✅ **Phase 4**: ADC Mock client + E2E harness

The extension code is complete. However, two HIGH findings (broken symlink detection, localhost acceptance) and one broken `package.json` path regression must be resolved.

---

## 16. Required Fixes

### HIGH — Must Fix Before E2E

| # | Finding | File(s) | Fix |
|---|---------|---------|-----|
| H-01 | Symlink detection broken — `fs.statSync` follows symlinks, so `isSymbolicLink()` is never true | `src/secrets.ts:52` | Replace `fs.statSync()` with `fs.lstatSync()` |
| H-02 | `localhost` accepted alongside `127.0.0.1` — violates spec requirement | `src/auth-service-client.ts:86`, `src/adc-mock-client.ts:68` | Remove `localhost` from accepted hostname check |

### MEDIUM — Should Fix

| # | Finding | File(s) | Fix |
|---|---------|---------|-----|
| M-01 | `package.json` `openclaw.extensions` path regression — changed from `./dist/index.js` to `./index.js` | `package.json` | Restore `./dist/index.js` |
| M-02 | `npm test` command broken — `node --test` cannot resolve `.ts` imports | `package.json` | Change to `"test": "npx tsx --test tests/*.test.ts"` |
| M-03 | No integration tests for HTTP clients (`auth-service-client`, `adc-mock-client`) | `tests/` | Add integration tests for Token request and ADC Mock call |
| M-04 | Predictable temp file `/tmp/oc-canary-config.json` — TOCTOU symlink race | `scripts/setup-canary.sh` | Use `mktemp` for secure temp file creation |
| M-05 | Cleanup script accepts arbitrary user arg without validation | `scripts/cleanup-canary.sh` | Add validation that `CANARY_USER` matches expected pattern |
| M-06 | No explicit proxy protection in fetch calls | `src/auth-service-client.ts`, `src/adc-mock-client.ts` | Add explicit proxy bypass or `NO_PROXY: '*'` |

---

## 17. Contradictions with the Implementation Report

| Report Claim | Actual State | Impact |
|-------------|-------------|--------|
| `FINAL_HEAD_SHA = 58fa2128d8e6e17470a8715e2437e6f072d0822d` | Actual SHA = `58fa212d1248a07de7ded0bf0e584bf5915c1372` | Different abbreviation; report was written before Phase 4 (bbcf14d) |
| `EXTENSION_LOADING_PATH = ~/.openclaw/extensions/.../index.js (global)` | `package.json` says `./index.js` | Works after setup script install; broken in workspace |
| `EXTENSION_ARTIFACT_DIGEST = e57bf060... (index.js)` | Digest only covers `index.js`, not full artifact bundle | Incomplete per spec requirement |
| `EXTENSION_ARTIFACT_MANIFEST = dist/MANIFEST.txt — 13 files` | Manifest is generated at install time by `setup-canary.sh` | Cannot verify without privileged execution |
| "42+ security tests recorded" | Documented as matrix only; not executable tests | Should not be counted as test results |
| "15 passing unit tests" | Config test command fails; passes with tsx | Test infrastructure broken |

---

## 18. Outcome

```text
OPENCLAW_ADC_CANARY_EXTENSION_V0_AUDIT_BLOCKED

BLOCKER_FINDINGS=0
HIGH_FINDINGS=2
NON_BLOCKING_FINDINGS=6

PRIVILEGED_E2E_OPERATOR_RUN_ALLOWED=no
MERGE_ALLOWED=no
PR_E1_IMPLEMENTATION_ALLOWED=no
PRODUCTION_DEPLOYMENT_ALLOWED=no
REAL_PROVISIONING_ALLOWED=no
```

### Path to E2E Authorization

1. **Fix H-01**: Replace `fs.statSync` with `fs.lstatSync` in `src/secrets.ts`
2. **Fix H-02**: Restrict hostname validation to `127.0.0.1` only
3. **Fix M-01**: Restore `openclaw.extensions` path in `package.json`
4. **Fix M-02**: Fix `npm test` command to use `tsx`
5. Address remaining MEDIUM findings as appropriate

After all HIGH findings are resolved and re-audited:
```text
PRIVILEGED_E2E_OPERATOR_RUN_ALLOWED=yes
```

### After E2E Completion

Even after successful privileged E2E:
```text
MERGE_ALLOWED=no
PR_E1_IMPLEMENTATION_ALLOWED=no
PRODUCTION_DEPLOYMENT_ALLOWED=no
```

These require separate acceptance after E2E evidence is submitted and audited.

---

*Report generated by Independent Audit Agent. No privileged OS operations were performed during this audit.*
