#!/bin/bash
#
# Phase 4: Clean up all temporary canary assets.
#
# Usage: sudo scripts/cleanup-canary.sh
#

set -euo pipefail

CANARY_USER="${1:-oc-canary-runtime}"
LEGACY_USER="${SUDO_USER:-yanfenma}"

echo "=== Canary Cleanup ==="

# Remove canary user (requires sudo)
if dscl . -list /Users | grep -q "^${CANARY_USER}\$"; then
    echo "Removing user ${CANARY_USER}..."
    sudo dscl . -delete "/Users/${CANARY_USER}"
fi

# Remove canary group
if dscl . -list /Groups | grep -q "^oc-canary\$"; then
    echo "Removing group oc-canary..."
    sudo dscl . -delete "/Groups/oc-canary"
fi

# Remove controlled directories (requires sudo)
for dir in "/private/etc/oc-canary" "/var/empty/oc-canary-workspace"; do
    if [ -d "${dir}" ]; then
        echo "Removing ${dir}..."
        sudo rm -rf "${dir}"
    fi
done

# Remove user-space canary env
if [ -d "${HOME}/.oc-canary" ]; then
    echo "Removing ${HOME}/.oc-canary..."
    rm -rf "${HOME}/.oc-canary"
fi

# Check for leftover processes
LEFTOVER=$(ps aux | grep -i "canary\|oc-canary" | grep -v grep || true)
if [ -n "${LEFTOVER}" ]; then
    echo "WARNING: Potential leftover processes found:"
    echo "${LEFTOVER}"
fi

echo "Cleanup complete."
