#!/bin/bash
#
# Phase 4: Clean up all temporary canary assets.
#
# Security (M-05):
#   - Fixed user name (no arbitrary --user parameter)
#   - UID must match setup marker
#   - Home directory must match expected pattern
#   - Shell must be /usr/bin/false
#   - User must NOT be in admin group
#   - Root-owned setup marker must exist
#   - Marker must contain expected run ID and resource manifest
#   - Extension/profile/secret dirs must be at fixed prefixes
#   - All conditions must pass or fail closed
#   - Idempotent: second run reports resources already cleaned
#
# Usage: sudo bash scripts/cleanup-canary.sh
#

set -euo pipefail

# ─── Fixed Configuration (M-05: no arbitrary parameters) ──────────────────
readonly CANARY_USER="oc-canary-runtime"
readonly GROUP_NAME="oc-canary"
readonly MARKER_DIR="/private/etc/oc-canary/.setup-marker"
readonly MARKER_FILE="${MARKER_DIR}/marker.txt"
readonly EXPECTED_SHELL="/usr/bin/false"
readonly EXPECTED_HOME_PREFIX="/var/empty"
readonly SECRET_DIR="/private/etc/oc-canary/secrets"
readonly CONFIG_DIR="/private/etc/oc-canary"
readonly EXT_LOAD_DIR="/private/etc/oc-canary/extensions/openclaw-adc-canary"

echo "============================================"
echo "Canary Cleanup"
echo "============================================"
echo ""

# ── Root check ────────────────────────────────────────────────────────────
if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: This script must be run with sudo or as root."
    exit 1
fi

# ── Check if canary user exists at all ────────────────────────────────────
if ! dscl . -list /Users | grep -q "^${CANARY_USER}\$"; then
    echo "  Canary user '${CANARY_USER}' does not exist."
    echo "  Checking for other cleanup items..."
fi

# ── Phase 1: Pre-cleanup validation ──────────────────────────────────────
echo "[Phase 1] Pre-cleanup validation..."

# V1: User name must be exactly the fixed name (M-05 §1)
if dscl . -list /Users | grep -q "^${CANARY_USER}\$"; then
    echo "  ✅ User name matches fixed value."

    # V2: UID must be recorded in marker (M-05 §2)
    if [ -f "${MARKER_FILE}" ]; then
        RECORDED_UID=$(grep "^CANARY_UID=" "${MARKER_FILE}" 2>/dev/null | cut -d= -f2)
        ACTUAL_UID=$(id -u "${CANARY_USER}" 2>/dev/null || echo "")
        if [ -n "${RECORDED_UID}" ] && [ "${ACTUAL_UID}" = "${RECORDED_UID}" ]; then
            echo "  ✅ UID matches marker (${ACTUAL_UID})."
        else
            echo "  ❌ UID mismatch: recorded=${RECORDED_UID:-none}, actual=${ACTUAL_UID:-none}"
            echo "  FAIL_CLOSED: User deletion aborted."
            exit 1
        fi
    else
        echo "  ❌ Marker file not found. Cannot verify UID."
        echo "  FAIL_CLOSED: User deletion aborted."
        exit 1
    fi

    # V3: Home directory must match expected pattern (M-05 §3)
    ACTUAL_HOME=$(dscl . -read "/Users/${CANARY_USER}" NFSHomeDirectory 2>/dev/null | awk '{print $2}')
    if [[ "${ACTUAL_HOME}" == "${EXPECTED_HOME_PREFIX}"* ]]; then
        echo "  ✅ Home directory matches expected prefix (${ACTUAL_HOME})."
    else
        echo "  ❌ Home directory unexpected: ${ACTUAL_HOME}"
        echo "  FAIL_CLOSED: User deletion aborted."
        exit 1
    fi

    # V4: Shell must be /usr/bin/false (M-05 §4)
    ACTUAL_SHELL=$(dscl . -read "/Users/${CANARY_USER}" UserShell 2>/dev/null | awk '{print $2}')
    if [ "${ACTUAL_SHELL}" = "${EXPECTED_SHELL}" ]; then
        echo "  ✅ Shell matches expected (${EXPECTED_SHELL})."
    else
        echo "  ❌ Shell unexpected: ${ACTUAL_SHELL}"
        echo "  FAIL_CLOSED: User deletion aborted."
        exit 1
    fi

    # V5: User must NOT be in admin group (M-05 §5)
    if groups "${CANARY_USER}" | grep -q '\badmin\b'; then
        echo "  ❌ User is in admin group! Refusing deletion."
        echo "  FAIL_CLOSED: User deletion aborted."
        exit 1
    fi
    echo "  ✅ User is not in admin group."

    # V6: Root-owned marker must exist (M-05 §6)
    if [ -f "${MARKER_FILE}" ] && [ "$(stat -f '%Su' "${MARKER_FILE}")" = "root" ]; then
        echo "  ✅ Root-owned marker exists."
    else
        echo "  ❌ Marker file missing or not owned by root."
        echo "  FAIL_CLOSED: User deletion aborted."
        exit 1
    fi

    # V7: Marker must contain run ID and resource manifest (M-05 §7)
    if grep -q "^RUN_ID=" "${MARKER_FILE}" && grep -q "^RESOURCE_MANIFEST=" "${MARKER_FILE}"; then
        echo "  ✅ Marker contains run ID and manifest."
    else
        echo "  ❌ Marker incomplete (missing run ID or manifest)."
        echo "  FAIL_CLOSED: User deletion aborted."
        exit 1
    fi

    echo "  All validations passed. Proceeding with cleanup."
else
    echo "  User does not exist — skipping user validation."
fi

# ── Phase 2: Execute cleanup ──────────────────────────────────────────────
echo ""
echo "[Phase 2] Executing cleanup..."

# Cleanup 1: Remove canary user
if dscl . -list /Users | grep -q "^${CANARY_USER}\$"; then
    echo "  Removing user ${CANARY_USER}..."
    sudo dscl . -delete "/Users/${CANARY_USER}"
    echo "  ✅ User removed."
else
    echo "  ✅ User already removed (or never existed)."
fi

# Cleanup 2: Remove canary group
if dscl . -list /Groups | grep -q "^${GROUP_NAME}\$"; then
    echo "  Removing group ${GROUP_NAME}..."
    sudo dscl . -delete "/Groups/${GROUP_NAME}"
    echo "  ✅ Group removed."
else
    echo "  ✅ Group already removed (or never existed)."
fi

# Cleanup 3: Remove /private/etc/oc-canary/ directory
for dir in "/private/etc/oc-canary" "/var/empty/oc-canary-workspace"; do
    if [ -d "${dir}" ]; then
        echo "  Removing ${dir}..."
        sudo rm -rf "${dir}"
        echo "  ✅ Removed."
    else
        echo "  ✅ ${dir} already removed (or never existed)."
    fi
done

# Cleanup 4: Remove user-space canary env
if [ -d "${HOME}/.oc-canary" ]; then
    echo "  Removing ${HOME}/.oc-canary..."
    rm -rf "${HOME}/.oc-canary"
    echo "  ✅ Removed."
fi

# Cleanup 5: Remove from ~/.openclaw/extensions/ if installed
if [ -d "${HOME}/.openclaw/extensions/openclaw-adc-canary" ]; then
    echo "  Removing ~/.openclaw/extensions/openclaw-adc-canary..."
    rm -rf "${HOME}/.openclaw/extensions/openclaw-adc-canary"
    echo "  ✅ Removed."
fi

# ── Phase 3: Post-cleanup check ──────────────────────────────────────────
echo ""
echo "[Phase 3] Post-cleanup verification..."
LEFTOVER=$(ps aux | grep -i "oc-canary\|openclaw-adc-canary" | grep -v grep || true)
if [ -n "${LEFTOVER}" ]; then
    echo "  ⚠️  Potential leftover processes:"
    echo "${LEFTOVER}"
fi

# Verify user is gone
if dscl . -list /Users | grep -q "^${CANARY_USER}\$"; then
    echo "  ❌ User still exists after deletion!"
    exit 1
fi
echo "  ✅ User confirmed deleted."

# Verify groups are gone
if dscl . -list /Groups | grep -q "^${GROUP_NAME}\$"; then
    echo "  ⚠️  Group still exists (manual removal may be needed)."
else
    echo "  ✅ Group confirmed deleted."
fi

echo ""
echo "CLEANUP_USER_DELETION_SCOPED=true"
echo "LEGACY_USER_DELETION_POSSIBLE=false"
echo "Cleanup complete."
