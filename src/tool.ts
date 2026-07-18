/**
 * adc_workflow_read — Canary V0 Trusted Tool.
 *
 * PROBE MODE (Phase 0 / Phase 1B): No secret reading, no network requests.
 * Returns the agent context identity for verification purposes only.
 *
 * FULL MODE (Phase 2+): Reads machine client secret, obtains Direct Token
 * from auth-service, and calls the ADC Mock.
 */

import { Type, type Static } from '@sinclair/typebox';
import type { OpenClawPluginToolContext } from './plugin-api.js';
import type { CanaryConfig } from './config.js';
import { AgentBindingError } from './errors.js';

// ─── Tool Schema ──────────────────────────────────────────────────────────

/**
 * AdcWorkflowRead parameters — empty schema.
 *
 * The tool accepts NO caller-supplied parameters. All security-critical
 * values (agentId, clientId, URLs, paths) come from the trusted deployment
 * config and the Gateway's session context, NOT from the model.
 *
 * additionalProperties=false ensures unknown fields are rejected.
 */
export const AdcWorkflowReadSchema = Type.Object(
  {},
  {
    additionalProperties: false,
    description: 'No parameters accepted. All routing and identity is derived from deployment config and Gateway session context.',
  },
);

export type AdcWorkflowReadParams = Static<typeof AdcWorkflowReadSchema>;

// ─── Tool Factory ─────────────────────────────────────────────────────────

/**
 * Create the adc_workflow_read tool using the factory pattern.
 *
 * The factory captures the OpenClawPluginToolContext (including context.agentId)
 * at registration time. The execute handler uses this captured context rather
 * than accepting agent identity from model parameters.
 *
 * @param config  Deployment config (expected agentId, origins, etc.)
 * @param probeMode  If true, skip secret/network and return identity probe result.
 */
export function createAdcWorkflowReadTool(
  config: CanaryConfig,
  probeMode: boolean = false,
) {
  return (ctx: OpenClawPluginToolContext) => ({
    name: 'adc_workflow_read',
    label: 'ADC Workflow Read (Canary V0)',
    description:
      '读取当前 Agent 的 ADC 工作流需求（只读）。'
      + '不返回 Token、Secret 或其他凭证。'
      + '不接受自定义参数。',
    parameters: AdcWorkflowReadSchema,
    execute: async (_toolCallId: string, _params: AdcWorkflowReadParams) => {
      // ── 1. Validate agent identity ────────────────────────────────────
      const actualAgentId = ctx.agentId;
      if (!actualAgentId) {
        throw new AgentBindingError(config.expectedAgentId, '(none)');
      }
      if (actualAgentId !== config.expectedAgentId) {
        throw new AgentBindingError(config.expectedAgentId, actualAgentId);
      }

      // ── 2. Probe mode: return identity confirmation only ──────────────
      if (probeMode) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                status: 'probe_ok',
                agentId: actualAgentId,
                tool: 'adc_workflow_read',
                mode: 'probe',
                message: 'Tool registration and agent identity verified. No secret or network access performed.',
              }),
            },
          ],
          details: {
            agentId: actualAgentId,
            mode: 'probe',
            config: {
              expectedAgentId: config.expectedAgentId,
              machineClientId: config.machineClientId,
            },
          },
        };
      }

      // ── 3. Full mode (Phase 2+) ───────────────────────────────────────
      // TODO: Implement in Phase 2
      throw new Error('Full mode not yet implemented (Phase 2)');
    },
  });
}
