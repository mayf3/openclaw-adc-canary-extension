# Main Gateway — Rollback Plan (GENERATED — NOT EXECUTED)

**Status**: Generated for independent audit review. Run only if rollback is needed.

## Quick Rollback (disable plugin without removing config)

```bash
# Method A: Disable via plugins.entries
jq '.plugins.entries["openclaw-auth-broker"].enabled = false' \
  ~/.openclaw/openclaw.json > tmp && mv tmp ~/.openclaw/openclaw.json

# Or set globalEnabled=false (if config should stay)
jq '.plugins.entries["openclaw-auth-broker"].config.globalEnabled = false' \
  ~/.openclaw/openclaw.json > tmp && mv tmp ~/.openclaw/openclaw.json

# Restart gateway
openclaw restart
```

## Full Rollback (remove plugin entirely)

```bash
# Remove the plugin entry
jq 'del(.plugins.entries["openclaw-auth-broker"])' \
  ~/.openclaw/openclaw.json > tmp && mv tmp ~/.openclaw/openclaw.json

# Remove from allowlist
jq '.plugins.allow -= ["openclaw-auth-broker"]' \
  ~/.openclaw/openclaw.json > tmp && mv tmp ~/.openclaw/openclaw.json

# Remove install record
jq 'del(.plugins.installs["openclaw-auth-broker"])' \
  ~/.openclaw/openclaw.json > tmp && mv tmp ~/.openclaw/openclaw.json

# Remove symlink
rm -f ~/.openclaw/extensions/openclaw-auth-broker

# Restart gateway
openclaw restart
```

## Verification After Rollback

```bash
# Verify plugin is gone
jq '.plugins.allow' ~/.openclaw/openclaw.json          # no openclaw-auth-broker
jq '.plugins.entries | keys' ~/.openclaw/openclaw.json  # original 4 only
jq '.agents.list | length' ~/.openclaw/openclaw.json    # = 78 (unchanged)
jq '.bindings | length' ~/.openclaw/openclaw.json       # = 78 (unchanged)
jq '.channels | keys' ~/.openclaw/openclaw.json         # = ["feishu"] (unchanged)
```

## Principles

1. Rollback is purely config-level — no database migration, no session rewrite.
2. Plugin removal does not affect any existing agent, binding, channel, or session.
3. No residual files in the main gateway profile.
4. The isolated canary profile (~/.openclaw-auth-canary/) is separate and not affected.
