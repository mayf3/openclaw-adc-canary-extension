#!/usr/bin/env bash
# ============================================================
# dev-canary-setup.sh — Create isolated OpenClaw canary profile
# ============================================================
#
# Creates ~/.openclaw-auth-canary/ directory for isolated
# gateway development, testing, and secret scanning.
#
# Usage:
#   ./scripts/dev-canary-setup.sh
#
# Environment:
#   OPENCLAW_PROFILE=auth-canary  (set by the script)
#   BROKER_DIR                    (path to broker plugin source)
#
# The script does NOT modify ~/.openclaw/openclaw.json.
# After running, start the gateway with:
#   OPENCLAW_PROFILE=auth-canary openclaw start
#
# Stop and clean up:
#   openclaw stop --profile auth-canary
#   rm -rf ~/.openclaw-auth-canary/
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BROKER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CANARY_DIR="$HOME/.openclaw-auth-canary"
PROFILE_NAME="auth-canary"

echo "[dev-canary-setup] Creating isolated OpenClaw profile at: $CANARY_DIR"
echo "[dev-canary-setup] Broker source: $BROKER_DIR"

# ── 1. Create canary directory ──────────────────────────────────────────
mkdir -p "$CANARY_DIR"
mkdir -p "$CANARY_DIR/extensions"

# ── 2. Symlink broker plugin into extensions ────────────────────────────
# This makes the plugin available to the isolated gateway
BROKER_SYMLINK="$CANARY_DIR/extensions/openclaw-auth-broker"
if [ ! -L "$BROKER_SYMLINK" ]; then
  ln -sf "$BROKER_DIR" "$BROKER_SYMLINK"
  echo "[dev-canary-setup] Symlinked broker plugin: $BROKER_SYMLINK → $BROKER_DIR"
fi

# ── 3. Create minimal openclaw.json for the canary profile ──────────────
# This is a MINIMAL config — only what's needed for broker testing.
# It does NOT include any existing agents, bindings, or channels.
CANARY_CONFIG="$CANARY_DIR/openclaw.json"

if [ ! -f "$CANARY_CONFIG" ]; then
  cat > "$CANARY_CONFIG" << 'CANARY_EOF'
{
  "meta": {
    "lastTouchedVersion": "0.1.0-canary",
    "description": "Isolated Auth Broker canary — not for production"
  },
  "plugins": {
    "allow": ["openclaw-auth-broker"],
    "entries": {
      "openclaw-auth-broker": {
        "enabled": true,
        "config": {
          "globalEnabled": false,
          "enabledAgentIds": ["auth-canary-agent"],
          "agentClients": {
            "auth-canary-agent": {
              "clientId": "openclaw-auth-canary-agent",
              "credentialRef": {
                "source": "env",
                "provider": "os",
                "id": "AUTH_CANARY_CLIENT_SECRET"
              }
            }
          },
          "targets": [
            {
              "targetId": "svc-workflow",
              "audience": "svc-workflow",
              "allowedOrigin": "http://localhost:8080"
            }
          ],
          "capabilities": [
            {
              "capabilityId": "workflow_my_tasks",
              "targetId": "svc-workflow",
              "requiredScopes": ["workflow.read"],
              "method": "GET",
              "path": "/api/v1/my-tasks"
            }
          ],
          "authServiceOrigin": "http://localhost:4982"
        }
      }
    },
    "installs": {
      "openclaw-auth-broker": {
        "source": "path",
        "spec": "extensions/openclaw-auth-broker"
      }
    }
  },
  "gateway": {
    "port": 19789,
    "mode": "local",
    "bind": "loopback"
  }
}
CANARY_EOF
  echo "[dev-canary-setup] Created minimal canary config: $CANARY_CONFIG"
else
  echo "[dev-canary-setup] Canary config already exists — not overwriting"
fi

# ── 4. Print setup instructions ─────────────────────────────────────────
echo ""
echo "============================================================"
echo "  Isolated Canary Profile Ready"
echo "============================================================"
echo ""
echo "  Profile directory: $CANARY_DIR"
echo "  Profile name:      $PROFILE_NAME"
echo ""
echo "  To start the isolated gateway:"
echo "    OPENCLAW_PROFILE=$PROFILE_NAME openclaw start"
echo ""
echo "  To enable the broker (default-off confirmed):"
echo "    set globalEnabled=true in the plugin config"
echo ""
echo "  To test:"
echo "    OPENCLAW_PROFILE=$PROFILE_NAME openclaw tool --agent auth-canary-agent workflow_my_tasks"
echo ""
echo "  To clean up:"
echo "    openclaw stop --profile $PROFILE_NAME"
echo "    rm -rf $CANARY_DIR"
echo ""
echo "  WARNING: This profile is isolated from your main gateway."
echo "  It does NOT modify ~/.openclaw/openclaw.json."
echo "============================================================"
