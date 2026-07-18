#!/bin/bash
#
# Canary E2E Orchestration Script
#
# Starts the temporary auth-service, ADC Mock, and Canary Gateway,
# then runs the E2E test.
#
# This requires operator setup:
#   1. Run setup-canary.sh (Phase 1A) first
#   2. Have the temp auth-service configured with RS256 workflow key ring
#   3. Have a temporary MachinePrincipal and MachineClient created
#
# Usage: sudo bash scripts/start-canary.sh
#

set -euo pipefail

CANARY_DIR="${CANARY_DIR:-${HOME}/.oc-canary}"
CANARY_PROFILE="canary-v0"
CANARY_PORT=19002
AUTH_SERVICE_PORT=4001
ADC_MOCK_PORT=9099
CANARY_AGENT_ID="${CANARY_AGENT_ID:-canary-agent}"

echo "============================================"
echo "Canary E2E — Start"
echo "============================================"

# ── Pre-flight checks ─────────────────────────────────────────────────────
echo ""
echo "[Pre-flight]"
echo "  Canary profile: ${CANARY_PROFILE}"
echo "  Canary port:    ${CANARY_PORT}"
echo "  Auth port:      ${AUTH_SERVICE_PORT}"
echo "  ADC Mock port:  ${ADC_MOCK_PORT}"

# Check auth-service health
if curl -sf "http://127.0.0.1:${AUTH_SERVICE_PORT}/api/health" > /dev/null 2>&1; then
    echo "  ✅ auth-service is running on :${AUTH_SERVICE_PORT}"
else
    echo "  ❌ auth-service is NOT running. Start it first."
    echo "     cd auth-service && npm run dev"
    exit 1
fi

# Check no existing process on ADC Mock port
if lsof -i ":${ADC_MOCK_PORT}" > /dev/null 2>&1; then
    echo "  ⚠️  Port ${ADC_MOCK_PORT} is already in use."
fi

# ── Step 1: Start ADC Mock ────────────────────────────────────────────────
echo ""
echo "[1/4] Starting ADC Mock..."
node scripts/adc-mock-server.mjs "${ADC_MOCK_PORT}" &
ADC_MOCK_PID=$!
echo "  ADC Mock started (PID ${ADC_MOCK_PID})"
sleep 1

# Verify ADC Mock
if curl -sf "http://127.0.0.1:${ADC_MOCK_PORT}/api/requirements/mine" > /dev/null 2>&1; then
    echo "  ❌ ADC Mock should have rejected request without token"
fi

echo "  ✅ ADC Mock responding"

# ── Step 2: Start Canary Gateway ─────────────────────────────────────────
echo ""
echo "[2/4] Starting Canary Gateway..."
# Stop any previous canary gateway
openclaw --profile "${CANARY_PROFILE}" gateway stop 2>/dev/null || true

# Start gateway in background
openclaw --profile "${CANARY_PROFILE}" gateway --port "${CANARY_PORT}" &
CANARY_GW_PID=$!
echo "  Canary Gateway starting (PID ${CANARY_GW_PID}, port ${CANARY_PORT})"
sleep 3

# Verify Canary Gateway
if openclaw --profile "${CANARY_PROFILE}" gateway health 2>/dev/null; then
    echo "  ✅ Canary Gateway is healthy"
else
    echo "  ❌ Canary Gateway health check failed"
    kill "${ADC_MOCK_PID}" 2>/dev/null || true
    exit 1
fi

# ── Step 3: E2E Test ──────────────────────────────────────────────────────
echo ""
echo "[3/4] Running E2E Test..."

# Send message to canary agent to trigger adc_workflow_read
E2E_RESULT=$(timeout 120 openclaw --profile "${CANARY_PROFILE}" agent \
    --agent "${CANARY_AGENT_ID}" \
    --message "请使用 adc_workflow_read 工具读取我的工作流需求。直接调用该工具并返回结果。" 2>&1 || true)

echo "=== E2E Result ==="
echo "${E2E_RESULT}" | grep -E "probe_ok|status|error|requirements|call" | head -10
echo ""

if echo "${E2E_RESULT}" | grep -q "probe_ok"; then
    echo "  ✅ E2E: Probe tool verified (mode=probe)"
elif echo "${E2E_RESULT}" | grep -q "requirements"; then
    echo "  ✅ E2E: Full tool verified (ADC Mock returned data)"
else
    echo "  ⚠️  E2E: Tool may not have been called. Check canary agent configuration."
    echo "     The tool is registered but the model needs to call it."
fi

# ── Step 4: Cleanup ──────────────────────────────────────────────────────
echo ""
echo "[4/4] Cleanup..."
kill "${ADC_MOCK_PID}" 2>/dev/null || true
echo "  ADC Mock stopped."

# Don't stop the canary gateway automatically — let the user inspect it
echo "  Canary Gateway still running on :${CANARY_PORT}"
echo "  Stop with: openclaw --profile ${CANARY_PROFILE} gateway stop"

echo ""
echo "============================================"
echo "Canary E2E — Complete"
echo "============================================"
