# Main Gateway — Single Agent Canary Plan (GENERATED — NOT EXECUTED)

**Status**: Generated for independent audit review. Do not apply to main gateway until audit passes.

## Objective

Install `openclaw-auth-broker` plugin on the **main gateway** (`~/.openclaw/openclaw.json`) so that:
- Only `auth-canary-agent` can use `workflow_my_tasks`
- All other 77 agents behave identically to pre-installation
- The plugin is **globalEnabled=false** by default (opt-in)

## Pre-flight Checks (audit must verify)

```text
MAIN_CONFIG_DIGEST_BEFORE=$(sha256sum ~/.openclaw/openclaw.json)
MAIN_EXTENSION_TREE_BEFORE=$(find ~/.openclaw/extensions/ -type f | sort | sha256sum)
```

## Step 1: Install Plugin Files

```bash
# Build broker plugin
cd /Users/yanfenma/workspace/project/openclaw-adc-canary-extension/broker
npm run build

# Symlink into extensions
ln -sf "$(pwd)" ~/.openclaw/extensions/openclaw-auth-broker
```

## Step 2: Apply Config Patch (see main-gateway-config-minimal-patch.json)

Apply the RFC 6902 JSON patch to `~/.openclaw/openclaw.json`.

The patch makes THREE additive operations only:
1. `op: add` → `/plugins/installs/openclaw-auth-broker`
2. `op: add` → `/plugins/entries/openclaw-auth-broker` (with globalEnabled: false)
3. `op: add` → `/plugins/allow/-` (append plugin id)

## Step 3: Verification

```text
# Verify preservation invariants
jq '.agents.list | length' ~/.openclaw/openclaw.json    # = 78
jq '.bindings | length' ~/.openclaw/openclaw.json         # = 78
jq '.channels | keys' ~/.openclaw/openclaw.json           # = ["feishu"]
jq '.gateway.port' ~/.openclaw/openclaw.json              # = 18789
jq '.gateway | keys' ~/.openclaw/openclaw.json   # unchanged set
jq '.auth.profiles' ~/.openclaw/openclaw.json             # unchanged
```

## Step 4: Enable Dance (manual, after audit)

```bash
# Enable globally
jq '.plugins.entries["openclaw-auth-broker"].config.globalEnabled = true' \
  ~/.openclaw/openclaw.json > tmp && mv tmp ~/.openclaw/openclaw.json

# Restart gateway
openclaw restart
```

## Step 5: Test

```bash
# As auth-canary-agent (should succeed)
openclaw tool --agent auth-canary-agent workflow_my_tasks

# As any other agent (should fail with "tool not available for this agent")
openclaw tool --agent cto-agent workflow_my_tasks    # → error
```

## Rollback

See main-gateway-rollback-plan.md.
