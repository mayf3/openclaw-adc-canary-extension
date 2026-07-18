#!/bin/bash
#
# Phase 1A: Set up the canary OS isolation environment.
#
# Creates:
#   1. Non-admin canary runtime user
#   2. Read-only secret test file
#   3. Immutable security config file
#   4. Installs extension artifact to controlled directory
#
# Usage: sudo scripts/setup-canary.sh
#
# No password is passed as command-line argument.
# The canary user is created without interactive login capability.
#

set -euo pipefail

CANARY_USER="oc-canary-runtime"
LEGACY_USER="${SUDO_USER:-yanfenma}"
SECRET_DIR="/private/etc/oc-canary/secrets"
SECRET_FILE="${SECRET_DIR}/adc-machine-client-secret"
CONFIG_DIR="/private/etc/oc-canary"
CONFIG_FILE="${CONFIG_DIR}/config.json"
EXT_LOAD_DIR="/private/etc/oc-canary/extensions/openclaw-adc-canary"
GROUP_NAME="oc-canary"

# Resolve development worktree
DEV_WORKTREE="/Users/${LEGACY_USER}/workspace/project/openclaw-adc-canary-extension"

echo "============================================"
echo "Canary Environment Setup (Phase 1A)"
echo "============================================"
echo ""

# ── Step 1: Create canary group ───────────────────────────────────────────
echo "[1/8] Creating canary group..."
if dscl . -list /Groups | grep -q "^${GROUP_NAME}\$"; then
    echo "  Group ${GROUP_NAME} already exists."
else
    sudo dscl . -create "/Groups/${GROUP_NAME}"
    sudo dscl . -create "/Groups/${GROUP_NAME}" PrimaryGroupID 599
    sudo dscl . -create "/Groups/${GROUP_NAME}" RealName "OpenClaw ADC Canary"
    echo "  Created group ${GROUP_NAME}."
fi

# ── Step 2: Create canary user ─────────────────────────────────────────────
echo "[2/8] Creating canary runtime user..."
if dscl . -list /Users | grep -q "^${CANARY_USER}\$"; then
    echo "  User ${CANARY_USER} already exists."
else
    # Find next available UID
    NEXT_UID=$(dscl . -list /Users UniqueID | awk '{print $2}' | sort -n | tail -1)
    NEXT_UID=$((NEXT_UID + 1))

    # Create user with no interactive login shell, non-admin
    sudo dscl . -create "/Users/${CANARY_USER}"
    sudo dscl . -create "/Users/${CANARY_USER}" UniqueID "${NEXT_UID}"
    sudo dscl . -create "/Users/${CANARY_USER}" PrimaryGroupID 599
    sudo dscl . -create "/Users/${CANARY_USER}" RealName "OpenClaw ADC Canary Runtime"
    sudo dscl . -create "/Users/${CANARY_USER}" UserShell "/usr/bin/false"
    sudo dscl . -create "/Users/${CANARY_USER}" NFSHomeDirectory "/var/empty"
    # Disable password-based authentication
    sudo dscl . -create "/Users/${CANARY_USER}" Password "*"
    sudo dscl . -create "/Users/${CANARY_USER}" AuthenticationAuthority ";DisabledUsers;"

    # Add to canary group
    sudo dseditgroup -o edit -a "${CANARY_USER}" -t user "${GROUP_NAME}"

    echo "  Created user ${CANARY_USER} (UID ${NEXT_UID}, no shell, no password)."
fi

# Verify user properties
CANARY_USER_SHELL=$(dscl . -read "/Users/${CANARY_USER}" UserShell 2>/dev/null | awk '{print $2}')
echo "  Shell: ${CANARY_USER_SHELL}"
if groups "${CANARY_USER}" | grep -q '\badmin\b'; then
    echo "  WARNING: User is in admin group! Removing..."
    sudo dseditgroup -o edit -d "${CANARY_USER}" -t user admin
fi
echo "  Groups: $(groups "${CANARY_USER}")"

# ── Step 3: Create secret directory and file ──────────────────────────────
echo "[3/8] Creating secret test file..."
sudo mkdir -p "${SECRET_DIR}"

# Create secret with a random value, generated internally (not from args)
CANARY_SECRET="oc-canary-secret-$(uuidgen | tr '[:upper:]' '[:lower:]')"
echo -n "${CANARY_SECRET}" | sudo tee "${SECRET_FILE}" > /dev/null

sudo chown root:"${GROUP_NAME}" "${SECRET_DIR}"
sudo chmod 750 "${SECRET_DIR}"

sudo chown root:"${GROUP_NAME}" "${SECRET_FILE}"
sudo chmod 440 "${SECRET_FILE}"

echo "  Secret file: ${SECRET_FILE}"
echo "  Secret file mode: $(stat -f '%Lp' "${SECRET_FILE}")"
echo "  Secret file owner: $(stat -f '%Su:%Sg' "${SECRET_FILE}")"

# ── Step 4: Create config directory and file ──────────────────────────────
echo "[4/8] Creating security config file..."
sudo mkdir -p "${CONFIG_DIR}"

cat > /tmp/oc-canary-config.json << 'CONFIGEOF'
{
  "expectedAgentId": "canary-agent",
  "machineClientId": "cm_placeholder",
  "authServiceOrigin": "http://127.0.0.1:4001",
  "adcMockOrigin": "http://127.0.0.1:9099",
  "secretFilePath": "/private/etc/oc-canary/secrets/adc-machine-client-secret",
  "pluginAllowlist": ["openclaw-adc-canary"],
  "extensionLoadPath": "/private/etc/oc-canary/extensions/openclaw-adc-canary"
}
CONFIGEOF

sudo mv /tmp/oc-canary-config.json "${CONFIG_FILE}"
sudo chown root:wheel "${CONFIG_FILE}"
sudo chmod 640 "${CONFIG_FILE}"

echo "  Config file: ${CONFIG_FILE}"
echo "  Config file mode: $(stat -f '%Lp' "${CONFIG_FILE}")"

# ── Step 5: Build extension ──────────────────────────────────────────────
echo "[5/8] Building extension..."
cd "${DEV_WORKTREE}"
npm run build 2>&1 | tail -3

# ── Step 6: Install extension to controlled directory ────────────────────
echo "[6/8] Installing extension to controlled directory..."
sudo rm -rf "${EXT_LOAD_DIR}"
sudo mkdir -p "${EXT_LOAD_DIR}"

# Copy all build artifacts
for f in dist/* openclaw.plugin.json package.json; do
    if [ -f "${DEV_WORKTREE}/${f}" ]; then
        sudo cp "${DEV_WORKTREE}/${f}" "${EXT_LOAD_DIR}/"
    fi
done

# Generate full artifact manifest and digest
echo "Generating artifact manifest..."
MANIFEST_FILE="${EXT_LOAD_DIR}/MANIFEST.txt"
DIGEST_FILE="${EXT_LOAD_DIR}/SHA256SUMS"

# Write manifest
{
    echo "# Extension Artifact Manifest"
    echo "# Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "# Source: ${DEV_WORKTREE}"
    echo ""
    ls -la "${EXT_LOAD_DIR}"
} | sudo tee "${MANIFEST_FILE}" > /dev/null

# Generate SHA256 digests for all artifact files (excluding the digest file itself)
(cd "${EXT_LOAD_DIR}" && sudo shasum -a 256 *.* | grep -v "SHA256SUMS") | sudo tee "${DIGEST_FILE}" > /dev/null

echo "  Artifact count: $(ls "${EXT_LOAD_DIR}" | wc -l) files"
echo "  Extension digest written to: ${DIGEST_FILE}"

# Set permissions - directories 750, files 640, scripts 750
sudo chown -R root:"${GROUP_NAME}" "${EXT_LOAD_DIR}"
sudo find "${EXT_LOAD_DIR}" -type d -exec chmod 750 {} \;
sudo find "${EXT_LOAD_DIR}" -type f -name "*.sh" -exec chmod 750 {} \;
sudo find "${EXT_LOAD_DIR}" -type f ! -name "*.sh" -exec chmod 640 {} \;

echo "  Extension dir mode: $(stat -f '%Lp' "${EXT_LOAD_DIR}")"
echo "  Extension owner: $(stat -f '%Su:%Sg' "${EXT_LOAD_DIR}")"

# ── Step 7: Create canary workspace directory ────────────────────────────
echo "[7/8] Creating canary workspace template..."
CANARY_WORKSPACE="/var/empty/oc-canary-workspace"
sudo mkdir -p "${CANARY_WORKSPACE}"
sudo chown "${CANARY_USER}:${GROUP_NAME}" "${CANARY_WORKSPACE}"
sudo chmod 750 "${CANARY_WORKSPACE}"

# ── Step 8: Verify setup ─────────────────────────────────────────────────
echo "[8/8] Running initial verification..."
echo ""

# Quick checks
echo "=== Quick Verification ==="
echo "Canary user: ${CANARY_USER}"
echo "  UID: $(id -u "${CANARY_USER}")"
echo "  Groups: $(groups "${CANARY_USER}")"
echo "  Shell: ${CANARY_USER_SHELL}"
echo "  Is admin: $([ "$(groups "${CANARY_USER}" | grep -c '\badmin\b')" -gt 0 ] && echo YES || echo NO)"
echo ""
echo "Secret file:"
echo "  Mode: $(stat -f '%Lp' "${SECRET_FILE}")"
echo "  Owner: $(stat -f '%Su:%Sg' "${SECRET_FILE}")"
echo "  Canary can read: $(sudo -u "${CANARY_USER}" test -r "${SECRET_FILE}" && echo YES || echo NO)"
echo "  Canary can write: $(sudo -u "${CANARY_USER}" touch "${SECRET_FILE}" 2>/dev/null && echo YES || echo NO)"
echo "  Legacy can read: $(sudo -u "${LEGACY_USER}" test -r "${SECRET_FILE}" 2>/dev/null && echo YES || echo NO)"
echo ""
echo "Extension directory:"
echo "  Mode: $(stat -f '%Lp' "${EXT_LOAD_DIR}")"
echo "  Owner: $(stat -f '%Su:%Sg' "${EXT_LOAD_DIR}")"
echo ""
echo "Setup complete. Run the full isolation test suite with:"
echo "  sudo scripts/verify-os-isolation.sh"
echo ""
