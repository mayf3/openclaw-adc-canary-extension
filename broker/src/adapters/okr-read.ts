/**
 * OKR Read Adapter — svc-okr canary capability.
 *
 * Registers an `okr_read` capability that lets a canary agent
 * read their own OKR goals from svc-okr via GET /api/goals/mine.
 *
 * The adapter:
 * - Declares an empty parameter schema (model supplies no inputs).
 * - Delegates all auth/token/fetch to BrokerCore.authorizedFetch().
 * - Normalizes svc-okr response into a model-readable format.
 * - DOES NOT read secrets, request tokens, or cache tokens.
 */

import { Type, type Static } from '@sinclair/typebox';
import type { OpenClawPluginToolContext, AgentTool } from '../plugin-api.js';
import { BrokerCore } from '../broker-core.js';

// ─── Capability ID ────────────────────────────────────────────────────────

/** The registered capability ID for this adapter. */
export const OKR_READ_CAPABILITY = 'okr_read';

// ─── Parameter Schema ─────────────────────────────────────────────────────

/**
 * Empty parameter schema — the model cannot supply any routing or auth values.
 *
 * The tool derives agent identity (ctx.agentId), target, audience, scope, and
 * URL path entirely from the trusted plugin configuration registered at startup.
 */
export const OkrReadSchema = Type.Object(
  {},
  {
    additionalProperties: false,
    description: 'Read the current agent\'s OKR goals. No parameters required — routing, identity, and access control are derived from deployment configuration.',
  },
);

export type OkrReadParams = Static<typeof OkrReadSchema>;

// ─── Tool Factory ─────────────────────────────────────────────────────────

/**
 * Create the okr_read tool.
 *
 * @param broker  The BrokerCore instance (shared across all adapters).
 */
export function createOkrReadTool(
  broker: BrokerCore,
) {
  return (_ctx: OpenClawPluginToolContext) => ({
    name: 'okr_read',
    label: 'OKR Read (Canary Proof)',
    description: '读取当前 Agent 的 OKR 目标卡（只读，Canary 验证用）。自动鉴权，无需传入任何参数。',
    parameters: OkrReadSchema as any,
    execute: async (
      _toolCallId: string,
      _params: OkrReadParams,
    ) => {
      const result = await broker.authorizedFetch(
        _ctx,
        OKR_READ_CAPABILITY,
        _params ?? {},
      );

      const responseText = typeof result === 'string'
        ? result
        : JSON.stringify(result);

      return {
        content: [{ type: 'text' as const, text: responseText }],
        details: { capability: OKR_READ_CAPABILITY },
      };
    },
  });
}
