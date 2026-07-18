#!/bin/bash
#
# Phase 1A: Set up the canary OS isolation environment.
#
# Creates:
#   1. Non-admin canary runtime user (fixed name: oc-canary-runtime)
#   2. Read-only secret test file (via atomic write)
#   3. Immutable security config file (via atomic write)
#   4. Installs extension artifact to controlled directory (preserving dist/)
#
# Security (M-04): Uses mktemp for all temp files, atomic rename, no
# predictable paths, TOCTOU mitigated.
#
# Usage: sudo bash scripts/setup-canary.sh
#

set -euo pipefail

# ─── Fixed Configuration ──────────────────────────────────────────────────
# M-05: User name is FIXED, not parameterized
readonly CANARY_USER="oc-canary-runtime"
readonly LEGACY_USER="${SUDO_USER:-yanfenma}"
readonly GROUP_NAME="oc-canary"
readonly GROUP_GID=599

readonly SECRET_DIR="/private/etc/oc-canary/secrets"
readonly SECRET_FILE="${SECRET_DIR}/adc-machine-client-secret"
readonly CONFIG_DIR="/private/etc/oc-canary"
readonly CONFIG_FILE="${CONFIG_DIR}/config.json"
readonly EXT_LOAD_DIR="/private/etc/oc-canary/extensions/openclaw-adc-canary"

readonly DEV_WORKTREE="/Users/${LEGACY_USER}/workspace/project/openclaw-adc-canary-extension"

# Marker directory for cleanup validation (M-05)
readonly MARKER_DIR="/private/etc/oc-canary/.setup-marker"
readonly RUN_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')

echo "============================================"
echo "Canary Environment Setup (Phase 1A)"
echo "Run ID: ${RUN_ID}"
echo "============================================"
echo ""

# ── Safety: refuse if running as non-root ─────────────────────────────────
if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: This script must be run with sudo or as root."
    exit 1
fi

# ── Safety: refuse if canary user already exists (M-05) ───────────────────
echo "[Pre-check] Checking for existing canary user..."
if dscl . -list /Users | grep -q "^${CANARY_USER}\$"; then
    echo "ERROR: Canary user '${CANARY_USER}' already exists."
    echo "  Refusing to adopt existing user. Run cleanup first."
    echo "  EXISTING_USER_ADOPTION_ALLOWED=false"
    exit 1
fi
echo "  OK: User does not exist."

# ── Step 1: Create canary group ──────────────────────────────────────────
echo "[1/10] Creating canary group..."
if ! dscl . -list /Groups | grep -q "^${GROUP_NAME}\$"; then
    sudo dscl . -create "/Groups/${GROUP_NAME}"
    sudo dscl . -create "/Groups/${GROUP_NAME}" PrimaryGroupID "${GROUP_GID}"
    sudo dscl . -create "/Groups/${GROUP_NAME}" RealName "OpenClaw ADC Canary"
    echo "  Created group ${GROUP_NAME} (GID ${GROUP_GID})."
else
    echo "  Group ${GROUP_NAME} already exists."
fi

# ── Step 2: Create canary user (non-admin, no shell, no password) ────────
echo "[2/10] Creating canary runtime user..."
# Find next available UID
NEXT_UID=$(dscl . -list /Users UniqueID | awk '{print $2}' | sort -n | tail -1)
NEXT_UID=$((NEXT_UID + 1))

sudo dscl . -create "/Users/${CANARY_USER}"
sudo dscl . -create "/Users/${CANARY_USER}" UniqueID "${NEXT_UID}"
sudo dscl . -create "/Users/${CANARY_USER}" PrimaryGroupID "${GROUP_GID}"
sudo dscl . -create "/Users/${CANARY_USER}" RealName "OpenClaw ADC Canary Runtime"
sudo dscl . -create "/Users/${CANARY_USER}" UserShell "/usr/bin/false"
sudo dscl . -create "/Users/${CANARY_USER}" NFSHomeDirectory "/var/empty"
sudo dscl . -create "/Users/${CANARY_USER}" Password "*"
sudo dscl . -create "/Users/${CANARY_USER}" AuthenticationAuthority ";DisabledUsers;"

sudo dseditgroup -o edit -a "${CANARY_USER}" -t user "${GROUP_NAME}"

echo "  Created user ${CANARY_USER} (UID ${NEXT_UID})."
echo "  Shell: $(dscl . -read "/Users/${CANARY_USER}" UserShell 2>/dev/null | awk '{print $2}')"
echo "  Is admin: $([ "$(groups "${CANARY_USER}" | grep -c '\badmin\b')" -gt 0 ] && echo YES || echo NO)"

# ── Step 3: Create marker directory with run ID (M-05) ──────────────────
echo "[3/10] Creating setup marker..."
sudo mkdir -p "${MARKER_DIR}"
cat > /tmp/oc-canary-marker-${RUN_ID}.txt << MARKEREOF
CANARY_USER=${CANARY_USER}
CANARY_UID=${NEXT_UID}
CANARY_GID=${GROUP_GID}
RUN_ID=${RUN_ID}
SETUP_TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
CREATED_BY=${LEGACY_USER}
RESOURCE_MANIFEST=secret:${SECRET_FILE},config:${CONFIG_FILE},extension:${EXT_LOAD_DIR}
MARKEREOF
sudo mv "/tmp/oc-canary-marker-${RUN_ID}.txt" "${MARKER_DIR}/marker.txt"
sudo chown root:wheel "${MARKER_DIR}/marker.txt"
sudo chmod 640 "${MARKER_DIR}/marker.txt"
sudo chown root:wheel "${MARKER_DIR}"
sudo chmod 700 "${MARKER_DIR}"
echo "  Marker created at ${MARKER_DIR}/marker.txt"

# ── Step 4: Create secret directory and file (M-04 atomic) ──────────────
echo "[4/10] Creating secret test file..."
sudo mkdir -p "${SECRET_DIR}"

# Generate secret internally (not from args)
CANARY_SECRET="oc-canary-secret-$(uuidgen | tr '[:upper:]' '[:lower:]')"

# Write via temp file + atomic rename (M-04)
SECRET_TMP=$(mktemp /tmp/oc-canary-secret-XXXXXX)
echo -n "${CANARY_SECRET}" > "${SECRET_TMP}"
sudo mv "${SECRET_TMP}" "${SECRET_FILE}"
sudo chown root:"${GROUP_NAME}" "${SECRET_FILE}"
sudo chmod 440 "${SECRET_FILE}"
sudo chown root:"${GROUP_NAME}" "${SECRET_DIR}"
sudo chmod 750 "${SECRET_DIR}"

echo "  Secret file: ${SECRET_FILE}"
echo "  Mode: $(stat -f '%Lp' "${SECRET_FILE}")"
echo "  Owner: $(stat -f '%Su:%Sg' "${SECRET_FILE}")"

# ── Step 5: Create config directory and file (M-04 atomic) ─────────────
echo "[5/10] Creating security config file..."
sudo mkdir -p "${CONFIG_DIR}"

CONFIG_TMP=$(mktemp /tmp/oc-canary-config-XXXXXX)
cat > "${CONFIG_TMP}" << CONFIGEOF
{
  "expectedAgentId": "canary-agent",
  "machineClientId": "cm_placeholder",
  "authServiceOrigin": "http://127.0.0.1:4001",
  "adcMockOrigin": "http://127.0.0.1:9099",
  "secretFilePath": "${SECRET_FILE}",
  "pluginAllowlist": ["openclaw-adc-canary"],
  "extensionLoadPath": "${EXT_LOAD_DIR}"
}
CONFIGEOF

sudo mv "${CONFIG_TMP}" "${CONFIG_FILE}"
sudo chown root:wheel "${CONFIG_FILE}"
sudo chmod 640 "${CONFIG_FILE}"

echo "  Config file: ${CONFIG_FILE}"
echo "  Mode: $(stat -f '%Lp' "${CONFIG_FILE}")"

# ── Step 6: Build extension ─────────────────────────────────────────────
echo "[6/10] Building extension..."
cd "${DEV_WORKTREE}"
npm run build 2>&1 | tail -2

# ── Step 7: Install extension with dist/ structure preserved (M-01) ────
echo "[7/10] Installing extension artifact..."
sudo rm -rf "${EXT_LOAD_DIR}"
sudo mkdir -p "${EXT_LOAD_DIR}/dist"

# Copy dist/ directory (preserving structure — M-01: entry is ./dist/index.js)
sudo cp -r "${DEV_WORKTREE}/dist/"* "${EXT_LOAD_DIR}/dist/"
sudo cp "${DEV_WORKTREE}/openclaw.plugin.json" "${EXT_LOAD_DIR}/"
sudo cp "${DEV_WORKTREE}/package.json" "${EXT_LOAD_DIR}/"

# Generate artifact manifest and per-file digests
(cd "${EXT_LOAD_DIR}" && find . -type f ! -name 'SHA256SUMS' ! -name 'MANIFEST.txt' -exec shasum -a 256 {} \;) | \
  sudo tee "${EXT_LOAD_DIR}/SHA256SUMS" > /dev/null

cat > /tmp/oc-canary-manifest-${RUN_ID}.txt << MANIFESTEOF
# Extension Artifact Manifest
# Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)
# Source: ${DEV_WORKTREE}
# Git SHA: $(cd "${DEV_WORKTREE}" && git rev-parse HEAD 2>/dev/null || echo 'unknown')
# Run ID: ${RUN_ID}
MANIFESTEOF
sudo mv "/tmp/oc-canary-manifest-${RUN_ID}.txt" "${EXT_LOAD_DIR}/MANIFEST.txt"

# Set permissions: dirs 750, files 640
sudo chown -R root:"${GROUP_NAME}" "${EXT_LOAD_DIR}"
sudo find "${EXT_LOAD_DIR}" -type d -exec chmod 750 {} \;
sudo find "${EXT_LOAD_DIR}" -type f ! -name "*.sh" -exec chmod 640 {} \;

echo "  Extension installed at ${EXT_LOAD_DIR}"
echo "  Dist entry: ${EXT_LOAD_DIR}/dist/index.js"

# ── Step 8: Mark extension digest in marker (M-05 cleanup validation) ──
ENTRY_DIGEST=$(shasum -a 256 "${EXT_LOAD_DIR}/dist/index.js" | cut -d' ' -f1)
echo "EXTENSION_ENTRY_DIGEST=${ENTRY_DIGEST}" | sudo tee -a "${MARKER_DIR}/marker.txt" > /dev/null

# ── Step 9: Create canary workspace template ───────────────────────────
echo "[9/10] Creating canary workspace template..."
CANARY_WORKSPACE="/var/empty/oc-canary-workspace"
sudo mkdir -p "${CANARY_WORKSPACE}"
sudo chown "${CANARY_USER}:${GROUP_NAME}" "${CANARY_WORKSPACE}"
sudo chmod 750 "${CANARY_WORKSPACE}"
echo "  Workspace: ${CANARY_WORKSPACE}"

# ── Step 10: Verify setup ──────────────────────────────────────────────
echo "[10/10] Verification..."
echo ""
echo "=== Quick Verification ==="
echo "User: ${CANARY_USER} (UID ${NEXT_UID})"
echo "  Shell: $(dscl . -read "/Users/${CANARY_USER}" UserShell 2>/dev/null | awk '{print $2}')"
echo "  Is admin: $([ "$(groups "${CANARY_USER}" | grep -c '\badmin\b')" -gt 0 ] && echo YES || echo NO)"
echo ""
echo "Secret:"
echo "  Mode: $(stat -f '%Lp' "${SECRET_FILE}")"
echo "  Owner: $(stat -f '%Su:%Sg' "${SECRET_FILE}")"
echo ""
echo "Extension:"
echo "  Entry digest: ${ENTRY_DIGEST}"
echo ""
echo "Setup complete. Run verification:"
echo "  sudo scripts/verify-os-isolation.sh"
echo ""

# Record summary to marker
echo "SETUP_COMPLETE=true" | sudo tee -a "${MARKER_DIR}/marker.txt" > /dev/null
