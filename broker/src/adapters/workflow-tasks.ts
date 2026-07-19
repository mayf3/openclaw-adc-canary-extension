/**
 * Workflow Adapter — workflow_my_tasks capability.
 *
 * Registers the `workflow_my_tasks` tool that lets a canary agent
 * read their workflow tasks from svc-workflow.
 *
 * The adapter:
 * - Declares an empty parameter schema (model supplies no inputs).
 * - Delegates all auth/token/fetch to BrokerCore.authorizedFetch().
 * - Normalizes svc-workflow response into a model-readable format.
 * - DOES NOT read secrets, request tokens, or cache tokens.
 */

import { Type, type Static } from '@sinclair/typebox';
import type { OpenClawPluginToolContext, AgentTool } from '../plugin-api.js';
import { BrokerCore } from '../broker-core.js';

// ─── Capability ID ────────────────────────────────────────────────────────

/** The registered capability ID for this adapter. */
export const WORKFLOW_MY_TASKS_CAPABILITY = 'workflow_my_tasks';

// ─── Parameter Schema ─────────────────────────────────────────────────────

/**
 * Empty parameter schema — the model cannot supply any routing or auth values.
 *
 * The tool derives agent identity (ctx.agentId), target, audience, scope, and
 * URL path entirely from the trusted plugin configuration registered at startup.
 */
export const WorkflowMyTasksSchema = Type.Object(
  {},
  {
    additionalProperties: false,
    description: 'Read the current agent\'s workflow tasks. No parameters required — routing, identity, and access control are derived from deployment configuration.',
  },
);

export type WorkflowMyTasksParams = Static<typeof WorkflowMyTasksSchema>;

// ─── Tool Factory ─────────────────────────────────────────────────────────

/**
 * Create the workflow_my_tasks tool.
 *
 * @param broker  The BrokerCore instance (shared across all adapters).
 */
export function createWorkflowTasksTool(
  broker: BrokerCore,
) {
  return (_ctx: OpenClawPluginToolContext) => ({
    name: 'workflow_my_tasks',
    label: 'Workflow My Tasks',
    description: '读取当前 Agent 的工作流任务（只读）。自动鉴权，无需传入任何参数。',
    parameters: WorkflowMyTasksSchema as any,
    execute: async (
      _toolCallId: string,
      _params: WorkflowMyTasksParams,
    ) => {
      // Everything happens via authorizedFetch — no token/secret touches here.
      const result = await broker.authorizedFetch(
        _ctx,
        WORKFLOW_MY_TASKS_CAPABILITY,
        _params ?? {},
      );

      // Normalize the response for model consumption.
      const responseText = typeof result === 'string'
        ? result
        : JSON.stringify(result);

      return {
        content: [{ type: 'text' as const, text: responseText }],
        details: { capability: WORKFLOW_MY_TASKS_CAPABILITY },
      };
    },
  });
}
