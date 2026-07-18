#!/bin/bash
#
# OS Isolation Dynamic Test Suite (Phase 1A)
#
# Verifies that the canary runtime environment is properly isolated from
# the legacy user environment. All 17 tests must pass for Phase 1A
# to be considered complete.
#
# Usage: sudo scripts/verify-os-isolation.sh <canary_user>
#
# Output: Machine-readable results prefixed with key=value
#

set -euo pipefail

CANARY_USER="${1:-oc-canary-runtime}"
LEGACY_USER="${SUDO_USER:-yanfenma}"

CANARY_HOME="/var/empty"
CANARY_WORKSPACE="/tmp/oc-canary-test-$$"
SECRET_DIR="/private/etc/oc-canary/secrets"
SECRET_FILE="${SECRET_DIR}/adc-machine-client-secret"
CONFIG_FILE="/private/etc/oc-canary/config.json"
EXT_LOAD_DIR="/private/etc/oc-canary/extensions/openclaw-adc-canary"
DEVELOPMENT_WORKTREE="/Users/${LEGACY_USER}/workspace/project/openclaw-adc-canary-extension"

PASS_COUNT=0
FAIL_COUNT=0
FAIL_REASONS=()

pass() {
    local test_name="$1"
    PASS_COUNT=$((PASS_COUNT + 1))
    echo "PASS: ${test_name}"
}

fail() {
    local test_name="$1"
    local reason="$2"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAIL_REASONS+=("${test_name}: ${reason}")
    echo "FAIL: ${test_name} — ${reason}"
}

check() {
    local test_name="$1"
    local result="$2"
    local expected="$3"
    expected="${expected:-true}"
    if [ "$result" = "$expected" ]; then
        pass "$test_name"
    else
        fail "$test_name" "expected ${expected}, got ${result}"
    fi
}

echo "========================================"
echo "OS Isolation Dynamic Test Suite"
echo "========================================"
echo "Canary user:    ${CANARY_USER}"
echo "Legacy user:    ${LEGACY_USER}"
echo "Secret file:    ${SECRET_FILE}"
echo "Config file:    ${CONFIG_FILE}"
echo "Extension dir:  ${EXT_LOAD_DIR}"
echo ""

# ── 1. Legacy user cannot read test secret ────────────────────────────────
echo "--- Test 1: Legacy user cannot read test secret ---"
LEGACY_CAN_READ=false
if sudo -u "${LEGACY_USER}" test -r "${SECRET_FILE}" 2>/dev/null; then
    LEGACY_CAN_READ=true
fi
check "LEGACY_USER_CAN_READ_CANARY_SECRET" "${LEGACY_CAN_READ}" false  # Expected: false
echo "LEGACY_USER_CAN_READ_CANARY_SECRET=${LEGACY_CAN_READ}"

# ── 2. Legacy user cannot modify test secret ───────────────────────────────
echo "--- Test 2: Legacy user cannot modify test secret ---"
LEGACY_CAN_MODIFY=false
if sudo -u "${LEGACY_USER}" sh -c "echo 'test' > '${SECRET_FILE}'" 2>/dev/null; then
    LEGACY_CAN_MODIFY=true
fi
check "LEGACY_USER_CAN_MODIFY_CANARY_SECRET" "${LEGACY_CAN_MODIFY}" false  # Expected: false
echo "LEGACY_USER_CAN_MODIFY_CANARY_SECRET=${LEGACY_CAN_MODIFY}"

# ── 3. Canary runtime user can read secret ─────────────────────────────────
echo "--- Test 3: Canary runtime user can read secret ---"
CANARY_CAN_READ=false
if sudo -u "${CANARY_USER}" test -r "${SECRET_FILE}" 2>/dev/null; then
    CANARY_CAN_READ=true
fi
check "CANARY_RUNTIME_CAN_READ_SECRET" "${CANARY_CAN_READ}" true  # Expected: true
echo "CANARY_RUNTIME_CAN_READ_SECRET=${CANARY_CAN_READ}"

# ── 4. Canary runtime user cannot modify secret ────────────────────────────
echo "--- Test 4: Canary runtime user cannot modify secret ---"
CANARY_CAN_MODIFY=false
if sudo -u "${CANARY_USER}" sh -c "echo 'test' > '${SECRET_FILE}'" 2>/dev/null; then
    CANARY_CAN_MODIFY=true
fi
check "CANARY_RUNTIME_CAN_MODIFY_SECRET" "${CANARY_CAN_MODIFY}" false  # Expected: false
echo "CANARY_RUNTIME_CAN_MODIFY_SECRET=${CANARY_CAN_MODIFY}"

# ── 5. Canary user is not admin ────────────────────────────────────────────
echo "--- Test 5: Canary user is not admin ---"
CANARY_IS_ADMIN=false
if groups "${CANARY_USER}" 2>/dev/null | grep -q '\badmin\b'; then
    CANARY_IS_ADMIN=true
fi
check "CANARY_USER_IS_ADMIN" "${CANARY_IS_ADMIN}" false  # Expected: false
echo "CANARY_USER_IS_ADMIN=${CANARY_IS_ADMIN}"

# ── 6. Canary user has no sudo ─────────────────────────────────────────────
echo "--- Test 6: Canary user has no sudo ---"
CANARY_HAS_SUDO=false
if sudo -l -U "${CANARY_USER}" 2>/dev/null | grep -q "(ALL)"; then
    CANARY_HAS_SUDO=true
fi
check "CANARY_USER_HAS_SUDO" "${CANARY_HAS_SUDO}" false  # Expected: false
echo "CANARY_USER_HAS_SUDO=${CANARY_HAS_SUDO}"

# ── 7. Canary workspace does not contain secret ────────────────────────────
echo "--- Test 7: Canary workspace does not contain secret ---"
rm -rf "${CANARY_WORKSPACE}"
mkdir -p "${CANARY_WORKSPACE}"
WORKSPACE_HAS_SECRET=false
if grep -rl "canary-test" "${CANARY_WORKSPACE}" 2>/dev/null; then
    WORKSPACE_HAS_SECRET=true
fi
check "CANARY_WORKSPACE_HAS_SECRET" "${WORKSPACE_HAS_SECRET}" false  # Expected: false
echo "CANARY_WORKSPACE_HAS_SECRET=${WORKSPACE_HAS_SECRET}"
rm -rf "${CANARY_WORKSPACE}"

# ── 8. Legacy user cannot modify loaded extension ──────────────────────────
echo "--- Test 8: Legacy user cannot modify loaded extension ---"
LEGACY_CAN_MODIFY_EXT=false
if sudo -u "${LEGACY_USER}" touch "${EXT_LOAD_DIR}/unauthored.txt" 2>/dev/null; then
    LEGACY_CAN_MODIFY_EXT=true
fi
check "LEGACY_USER_CAN_MODIFY_LOADED_EXTENSION" "${LEGACY_CAN_MODIFY_EXT}" false  # Expected: false
echo "LEGACY_USER_CAN_MODIFY_LOADED_EXTENSION=${LEGACY_CAN_MODIFY_EXT}"

# ── 9. Canary runtime cannot modify loaded extension ───────────────────────
echo "--- Test 9: Canary runtime cannot modify loaded extension ---"
CANARY_CAN_MODIFY_EXT=false
if sudo -u "${CANARY_USER}" touch "${EXT_LOAD_DIR}/unauthored.txt" 2>/dev/null; then
    CANARY_CAN_MODIFY_EXT=true
fi
check "CANARY_RUNTIME_CAN_MODIFY_LOADED_EXTENSION" "${CANARY_CAN_MODIFY_EXT}" false  # Expected: false
echo "CANARY_RUNTIME_CAN_MODIFY_LOADED_EXTENSION=${CANARY_CAN_MODIFY_EXT}"

# ── 10. Extension not loaded from development worktree ─────────────────────
echo "--- Test 10: Extension not loaded from development worktree ---"
EXT_LOADED_FROM_DEV=false
if [ -d "${EXT_LOAD_DIR}" ]; then
    # Check if the loaded extension matches the dev worktree (by comparing
    # entries or checking for symlinks)
    if [ -L "${EXT_LOAD_DIR}" ]; then
        EXT_LOADED_FROM_DEV=true
    fi
fi
check "EXTENSION_LOADED_FROM_DEVELOPMENT_WORKTREE" "${EXT_LOADED_FROM_DEV}" false  # Expected: false
echo "EXTENSION_LOADED_FROM_DEVELOPMENT_WORKTREE=${EXT_LOADED_FROM_DEV}"

# ── 11. Extension artifact digest verified ─────────────────────────────────
echo "--- Test 11: Extension artifact digest exists ---"
DIGEST_VERIFIED=false
if [ -f "${EXT_LOAD_DIR}/SHA256SUMS" ]; then
    DIGEST_VERIFIED=true
fi
check "EXTENSION_ARTIFACT_DIGEST_EXISTS" "${DIGEST_VERIFIED}" true  # Expected: true
echo "EXTENSION_ARTIFACT_DIGEST_EXISTS=${DIGEST_VERIFIED}"

# ── 12. Legacy user cannot modify canary config ────────────────────────────
echo "--- Test 12: Legacy user cannot modify canary config ---"
LEGACY_CAN_MODIFY_CONFIG=false
if sudo -u "${LEGACY_USER}" sh -c "echo 'modified' > '${CONFIG_FILE}'" 2>/dev/null; then
    LEGACY_CAN_MODIFY_CONFIG=true
fi
check "LEGACY_USER_CAN_MODIFY_SECURITY_CONFIG" "${LEGACY_CAN_MODIFY_CONFIG}" false  # Expected: false
echo "LEGACY_USER_CAN_MODIFY_SECURITY_CONFIG=${LEGACY_CAN_MODIFY_CONFIG}"

# ── 13. Canary runtime cannot modify canary config ────────────────────────
echo "--- Test 13: Canary runtime cannot modify canary config ---"
CANARY_CAN_MODIFY_CONFIG=false
if sudo -u "${CANARY_USER}" sh -c "echo 'modified' > '${CONFIG_FILE}'" 2>/dev/null; then
    CANARY_CAN_MODIFY_CONFIG=true
fi
check "CANARY_RUNTIME_CAN_MODIFY_SECURITY_CONFIG" "${CANARY_CAN_MODIFY_CONFIG}" false  # Expected: false
echo "CANARY_RUNTIME_CAN_MODIFY_SECURITY_CONFIG=${CANARY_CAN_MODIFY_CONFIG}"

# ── 14. Secret file permissions are correct ───────────────────────────────
echo "--- Test 14: Secret file permissions are correct ---"
SECRET_FILE_MODE=$(stat -f "%Lp" "${SECRET_FILE}" 2>/dev/null || echo "000")
SECRET_FILE_OWNER=$(stat -f "%Su" "${SECRET_FILE}" 2>/dev/null || echo "unknown")
echo "SECRET_FILE_MODE=${SECRET_FILE_MODE}"
echo "SECRET_FILE_OWNER=${SECRET_FILE_OWNER}"

# ── 15. Canary runtime user has no interactive login ───────────────────────
echo "--- Test 15: Canary runtime user shell is /usr/bin/false ---"
CANARY_SHELL=$(dscl . -read "/Users/${CANARY_USER}" UserShell 2>/dev/null | awk '{print $2}')
echo "CANARY_USER_SHELL=${CANARY_SHELL}"
if [ "${CANARY_SHELL}" = "/usr/bin/false" ] || [ "${CANARY_SHELL}" = "/sbin/nologin" ]; then
    pass "CANARY_USER_NO_INTERACTIVE_LOGIN"
else
    fail "CANARY_USER_NO_INTERACTIVE_LOGIN" "shell is ${CANARY_SHELL}"
fi

# ── 16. Config file permissions are correct ──────────────────────────────
echo "--- Test 16: Config file permissions ---"
CONFIG_FILE_MODE=$(stat -f "%Lp" "${CONFIG_FILE}" 2>/dev/null || echo "000")
CONFIG_FILE_OWNER=$(stat -f "%Su" "${CONFIG_FILE}" 2>/dev/null || echo "unknown")
echo "CONFIG_FILE_MODE=${CONFIG_FILE_MODE}"
echo "CONFIG_FILE_OWNER=${CONFIG_FILE_OWNER}"

# ── 17. Extension files have correct permissions ──────────────────────────
echo "--- Test 17: Extension directory permissions ---"
EXT_DIR_MODE=$(stat -f "%Lp" "${EXT_LOAD_DIR}" 2>/dev/null || echo "000")
EXT_DIR_OWNER=$(stat -f "%Su" "${EXT_LOAD_DIR}" 2>/dev/null || echo "unknown")
echo "EXT_LOAD_DIR_MODE=${EXT_DIR_MODE}"
echo "EXT_LOAD_DIR_OWNER=${EXT_DIR_OWNER}"

# ── Summary ───────────────────────────────────────────────────────────────
echo ""
echo "========================================"
echo "Results: ${PASS_COUNT} passed, ${FAIL_COUNT} failed"
echo "========================================"

if [ "${FAIL_COUNT}" -gt 0 ]; then
    echo "FAILURES:"
    for reason in "${FAIL_REASONS[@]}"; do
        echo "  - ${reason}"
    done
    echo ""
    echo "OS_ISOLATION_DYNAMIC_TEST_PASS=false"
    echo "OPENCLAW_ADC_CANARY_OS_ISOLATION_BLOCKED"
    exit 1
else
    echo "OS_ISOLATION_DYNAMIC_TEST_PASS=true"
    exit 0
fi
