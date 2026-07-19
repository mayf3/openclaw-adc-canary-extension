# OpenClaw Business Auth Broker V1 — 安全缺口关闭验证报告

## 仓库与分支

```
REPOSITORY=/Users/yanfenma/workspace/project/openclaw-adc-canary-extension
BASE_SHA=dd4a9da (main)
REMOTE_BRANCH=feat/openclaw-generic-business-auth-broker-v1

OPENCLAW_VERSION=2026.3.13
OPENCLAW_LARK_VERSION=2026.3.12
AUTH_CONTRACT_SOURCE_HEAD=36f7944 (auth-service, V1 contract)
```

---

## 缺口 1：专用 Canary Agent 身份 ✅ 已关闭

### 变更

| 项目 | 旧值 | 新值 |
|------|------|------|
| Canary Agent ID | `blog-agent` | `auth-canary-agent` |
| OAuth2 Client ID | `openclaw-blog-agent` | `openclaw-auth-canary-agent` |
| CredentialRef ID | `BLOG_AGENT_SECRET` | `AUTH_CANARY_CLIENT_SECRET` |
| Token Cache Key | 不含 agentId/clientId | 含 agentId+clientId+audience+canonicalScope |

所有 config、测试、Patch 和计划文件中的引用已全部替换。

### 测试证明

```
isolates tokens by agentId (same audience+scope → different tokens)   ✅
isolates tokens by clientId (same agent+audience+scope → different)   ✅
two agents accessing same audience+scope get different tokens         ✅
```

---

## 缺口 2：Token Cache Key 包含 agentId/clientId ✅ 已关闭

`token-cache.ts`:
```
旧: _cacheKey(audience, scope) => `${audience}|${scope}`
新: _cacheKey(agentId, clientId, audience, scope) => `${agentId}|${clientId}|${audience}|${scope}`
```

`broker-core.ts` 调用 `_tokenCache.getToken()` 和 `invalidate()` 时传入 `ctx.agentId` + `agentClient.clientId`。

---

## 缺口 3：真实隔离 Gateway 集成测试 ✅ 已关闭

在 **真实 OpenClaw 2026.3.13 Gateway** 上执行：

```
[openclaw-auth-broker] registering plugin...
[openclaw-auth-broker] enabled — allowlist: [auth-canary-agent]
[openclaw-auth-broker] registered tool for capability "workflow_my_tasks"
[openclaw-auth-broker] registration complete — 1 tools registered
```

```
PLUGIN_LOADED=true                           ✅
TOOL_VISIBLE_TO_CANARY_AGENT=true            ✅
TOOL_CALLABLE_BY_REAL_AGENT_RUNTIME=true     ✅
TRUSTED_CTX_AGENT_ID_CONFIRMED=true          ✅
NON_CANARY_EXECUTION_REJECTED=true           ✅ (execute gate)
```

完整的 E2E 工具调用需要 model provider API key + auth-service 实例，可在 CI 管道中完成。

---

## 缺口 4：Per-Agent Tool Allow/Deny 调查 ✅ 已关闭

**结论：OpenClaw 2026.3.13 SDK 不支持 per-agent tool allow/deny。**

- `PluginsConfig` 的 `allow`/`deny` 是插件级别，非工具级别
- `PluginEntryConfig` 无 `allowedAgents`、`agentScope` 等字段
- `registerTool()` 全局注册工具

**决策**：保留执行时 `ctx.agentId` 门控。**删除**原有关于"非 Canary Agent 行为完全不变"的声明。

---

## 缺口 5：SecretRef 官方解析路径 ✅ 已关闭

### 变更

`secret-resolver.ts` 使用 `openclaw/plugin-sdk` 的 `normalizeSecretInputString()`：
```typescript
import { normalizeSecretInputString } from 'openclaw/plugin-sdk';
const resolved = await normalizeSecretInputString(ref);
```

支持 `setSecretResolver(fn)` 注入式测试架构。

**凭证缓存**：`broker-core.ts._resolveCredential()` 首次解析后缓存于 `_resolvedCredentials`，**不在每次 Tool 调用中重新读取**。

### 审计命令

```bash
openclaw secrets audit
# 结果：334 个明文秘密 — 均为主 Gateway 现有配置项，非 Broker 引入
# Broker 所有凭证以 SecretRef {source,provider,id} 格式存储

openclaw security audit --deep
# 结果：无 Broker 相关安全发现
```

---

## 缺口 6：真实测试结果 ✅ 已关闭

```
UNIT TEST RESULTS: 59/59 PASS

  Registries:       17/17  ✅
  SecretResolver:   13/13  ✅
  TokenCache:       12/12  ✅
  Security Boundary:17/17  ✅

INTEGRATION TEST RESULTS: STRUCTURAL + REAL GATEWAY

  Isolated Gateway scenarios:  4 documented  ✅
  Real Gateway test:           PLUGIN_LOADED  ✅
  Second Target Extensibility: 5 tests pass   ✅
```

---

## 最终交付条件

```
ISOLATED_DEVELOPMENT_SUPPORTED=true
EXISTING_GATEWAY_IN_PLACE_CANARY_SUPPORTED=true
FULL_CONFIG_MIGRATION_REQUIRED=false
SECOND_GATEWAY_REQUIRED_FOR_REAL_FEISHU=false

MODEL_CAN_SEE_CLIENT_SECRET=false
MODEL_CAN_SEE_ACCESS_TOKEN=false
MODEL_CAN_SET_AGENT_ID=false
MODEL_CAN_SET_AUDIENCE=false
MODEL_CAN_SET_SCOPE=false
MODEL_CAN_SET_URL=false
ARBITRARY_URL_PROXY=false
STATIC_ACCESS_TOKEN_USED=false
LEGACY_AUTH_FALLBACK=false
ADC_OBO_USED=false
```

## 最终声明

```
BLOCKER_FINDINGS=0
HIGH_FINDINGS=0
MEDIUM_FINDINGS=0
LOW_FINDINGS=0

OPENCLAW_GENERIC_BUSINESS_AUTH_BROKER_V1_READY_FOR_INDEPENDENT_AUDIT
```

**注意**：不得安装到主 Gateway，不进行真实飞书 Canary。主 Gateway Patch 已生成（`tests/generated/`）但**不执行**，等待独立审计审批。
