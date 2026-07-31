/**
 * OpenClaw Business Auth Broker V1 — Entry Point
 *
 * Lifecycle:
 *   1. register(api) is called by the Gateway at startup.
 *   2. If config.globalEnabled !== true, no tools are registered
 *      → all agents behave as if the plugin is not installed.
 *   3. If globalEnabled is true, tools are registered for each configured
 *      capability. Per-agent gating happens inside execute():
 *      - Agents NOT in enabledAgentIds receive a fail-closed error.
 *      - Only allowed agents can successfully invoke broker tools.
 *   4. Plugin disable (plugins.entries.<id>.enabled=false) or removal
 *      from plugins.allow causes clean unload with no residual effects.
 *
 * Security:
 *   - ctx.agentId is trusted (from Gateway session, not model input).
 *   - Tool parameter schemas are empty — model supplies no routing or auth values.
 *   - Secrets and tokens live only in helper modules, never in parameters.
 *   - Agent allowlist gate runs inside execute(), before any auth/token work.
 */

import type { OpenClawPluginApi, OpenClawPluginToolContext, AnyAgentTool } from './plugin-api.js';
import type { BrokerPluginConfig } from './registries.js';
import { Registries, ConfigValidationError } from './registries.js';
import { BrokerCore, AgentNotAllowedError } from './broker-core.js';
import { createWorkflowTasksTool } from './adapters/workflow-tasks.js';
import { createTestReadTool } from './adapters/test-read.js';
import { createOkrReadTool } from './adapters/okr-read.js';
import { createWorkflowSubmissionHistoryTool } from './adapters/workflow-submission-history.js';

// ─── Adapter Registry ─────────────────────────────────────────────────────

/**
 * Map of capabilityId → adapter factory.
 *
 * Adding a new business service requires:
 *   1. Write an adapter file in src/adapters/
 *   2. Add it to this map
 *   3. Add the capability config to the plugin config block
 *
 * No changes to BrokerCore or Registries.
 */
const ADAPTERS: Record<
  string,
  (broker: BrokerCore) => (ctx: OpenClawPluginToolContext) => AnyAgentTool
> = {
  'workflow_my_tasks': createWorkflowTasksTool,
  'test_read': createTestReadTool,
  'okr_read': createOkrReadTool,
  'workflow_submission_history': createWorkflowSubmissionHistoryTool,
};

// ─── Plugin Registration ──────────────────────────────────────────────────

export default function register(api: OpenClawPluginApi): void {
  api.logger.info('[openclaw-auth-broker] registering plugin...');

  // ── Step 1: Read config ──────────────────────────────────────────────
  const config = api.pluginConfig as unknown as BrokerPluginConfig | undefined;

  // ── Step 2: Global kill switch gate ───────────────────────────────────
  if (!config?.globalEnabled) {
    api.logger.info(
      '[openclaw-auth-broker] globally disabled (globalEnabled=false) — no tools registered',
    );
    // No tools registered → all agents behave exactly as before plugin installation.
    return;
  }

  // ── Step 3: Validate config and initialize registries ─────────────────
  let registries: Registries;
  let broker: BrokerCore;
  try {
    registries = new Registries(config);
    broker = new BrokerCore(registries);
  } catch (err: any) {
    api.logger.error(
      `[openclaw-auth-broker] config validation failed: ${err.message}`,
    );
    // Validation failure is fatal — don't register partial tools.
    throw err;
  }

  api.logger.info(
    `[openclaw-auth-broker] enabled — allowlist: [${registries.enabledAgentIds.join(', ')}]`,
  );

  // ── Step 4: Register tools for each configured capability ────────────
  let registeredCount = 0;

  for (const cap of config.capabilities) {
    const adapterFactory = ADAPTERS[cap.capabilityId];

    if (!adapterFactory) {
      api.logger.warn(
        `[openclaw-auth-broker] no adapter implementation for capability "${cap.capabilityId}" — skipping`,
      );
      continue;
    }

    // Create the tool factory (captures broker + registries via closure).
    // The factory is called by the Gateway per-session to produce a tool instance.
    // The returned tool has an execute() that performs per-agent gating.
    const toolFactory = adapterFactory(broker);

    // Wrap the tool factory with the per-agent allowlist gate.
    const gatedFactory = (ctx: OpenClawPluginToolContext) => {
      const tool = toolFactory(ctx);

      // Wrap the execute method with agent gating.
      const originalExecute = tool.execute.bind(tool);
      tool.execute = async (
        toolCallId: string,
        params: Record<string, unknown>,
      ) => {
        // Per-agent allowlist gate — runs before any auth/token/fetch.
        try {
          registries.assertAgentAllowed(ctx.agentId ?? '');
        } catch (err) {
          if (err instanceof AgentNotAllowedError) {
            return {
              content: [{
                type: 'text' as const,
                text: `This tool is not available for the current agent.`,
              }],
              details: { error: 'agent_not_allowed', agentId: ctx.agentId },
            };
          }
          throw err;
        }

        return originalExecute(toolCallId, params);
      };

      return tool;
    };

    api.registerTool(gatedFactory);
    registeredCount++;
    api.logger.info(
      `[openclaw-auth-broker] registered tool for capability "${cap.capabilityId}"`,
    );
  }

  api.logger.info(
    `[openclaw-auth-broker] registration complete — ${registeredCount} tools registered`,
  );
}
