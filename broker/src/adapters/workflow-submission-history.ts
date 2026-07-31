/**
 * Workflow Submission History Adapter — workflow_submission_history capability.
 *
 * Lets a history-participant agent read the submission history of a workflow
 * instance from svc-workflow via:
 *   GET /internal/v1/workflow-instances/{workflowInstanceId}/submissions
 *
 * The adapter is THIN and owns ONLY business validation:
 *  - workflowInstanceId must be a valid UUID.
 *  - limit is bounded to svc-workflow's accepted range (1..100).
 *  - the pagination cursor (afterCreatedAt, afterId) must be paired
 *    (both present or both absent). A half cursor is a client input error
 *    (400 semantics), NOT an auth failure.
 *
 * It then hands a GENERIC { pathParams, query } binding to BrokerCore, which
 * knows nothing about Workflow field names — Core only does placeholder
 * matching, encodeURIComponent, and query serialization.
 *
 * The svc-workflow response is passed through VERBATIM (no field dropping,
 * reordering, filtering, or 404→[] conversion). svc-workflow enforces the
 * actual visibility / fail-closed semantics.
 *
 * Security:
 *  - agent identity and token are derived from ctx.agentId via BrokerCore.
 *  - additionalProperties:false rejects actorPrincipalId / Authorization.
 *  - DOES NOT read secrets, request tokens, or cache tokens.
 */

import { Type, type Static } from '@sinclair/typebox';
import type { OpenClawPluginToolContext, AgentTool } from '../plugin-api.js';
import { BrokerCore, RequestBindingError } from '../broker-core.js';

// ─── Capability ID ────────────────────────────────────────────────────────

/** The registered capability ID for this adapter. */
export const WORKFLOW_SUBMISSION_HISTORY_CAPABILITY = 'workflow_submission_history';

// ─── Parameter Schema ─────────────────────────────────────────────────────

/**
 * Canonical RFC 4122 UUID (8-4-4-4-12 hex), case-insensitive.
 * Used for workflowInstanceId and afterId.
 */
const UUID_PATTERN =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

/**
 * Input schema. All business validation lives here, not in BrokerCore.
 *
 * The model CANNOT supply actorPrincipalId or Authorization —
 * additionalProperties:false enforces that, and those values are always
 * derived from the trusted Agent identity in BrokerCore.
 */
export const WorkflowSubmissionHistorySchema = Type.Object(
  {
    /** Required: the workflow instance to read submission history for. */
    workflowInstanceId: Type.String({
      pattern: UUID_PATTERN,
      description: 'The workflow instance ID (canonical UUID) to read submission history for.',
    }),
    /** Optional: max items to return. svc-workflow accepts 1..100 (default 50). */
    limit: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 100 }),
    ),
    /**
     * Optional pagination cursor. afterCreatedAt and afterId MUST be provided
     * together (both or neither). A half cursor is rejected as a 400 input error.
     */
    afterCreatedAt: Type.Optional(
      Type.String({ format: 'date-time' }),
    ),
    /** Optional: the submission UUID portion of the pagination cursor. */
    afterId: Type.Optional(
      Type.String({ pattern: UUID_PATTERN }),
    ),
  },
  {
    additionalProperties: false,
    description:
      'Read the submission history of a workflow instance visible to the current agent (read-only). ' +
      'workflowInstanceId is required (UUID). limit, afterCreatedAt, afterId are optional; ' +
      'afterCreatedAt and afterId must be provided together. Routing, identity, and access control ' +
      'are derived from deployment configuration — do NOT supply actorPrincipalId or Authorization.',
  },
);

export type WorkflowSubmissionHistoryParams = Static<typeof WorkflowSubmissionHistorySchema>;

// ─── Adapter-Level Business Validation ────────────────────────────────────

/**
 * Validate cursor pairing: afterCreatedAt and afterId must be both-present
 * or both-absent. A half cursor is a client input error (NOT an auth failure).
 * @throws RequestBindingError (400) when only one cursor field is supplied.
 */
function assertCursorPaired(params: WorkflowSubmissionHistoryParams): void {
  const hasCreated = params.afterCreatedAt !== undefined && params.afterCreatedAt !== '';
  const hasId = params.afterId !== undefined && params.afterId !== '';
  if (hasCreated !== hasId) {
    throw new RequestBindingError(
      'pagination cursor must be paired: provide afterCreatedAt and afterId together, or omit both',
    );
  }
}

// ─── Tool Factory ─────────────────────────────────────────────────────────

/**
 * Create the workflow_submission_history tool.
 *
 * @param broker  The BrokerCore instance (shared across all adapters).
 */
export function createWorkflowSubmissionHistoryTool(
  broker: BrokerCore,
) {
  return (_ctx: OpenClawPluginToolContext) => ({
    name: 'workflow_submission_history',
    label: 'Workflow Submission History',
    description:
      '读取某个工作流实例的提交历史（只读，当前 Agent 有权看到的部分）。workflowInstanceId 必填（UUID）；' +
      'limit、afterCreatedAt、afterId 可选，后两者须成对提供。自动鉴权，禁止传入 actorPrincipalId 或 Authorization。',
    parameters: WorkflowSubmissionHistorySchema as any,
    execute: async (
      _toolCallId: string,
      _params: Record<string, unknown>,
    ) => {
      const params = (_params ?? {}) as WorkflowSubmissionHistoryParams;

      // 1. Adapter-owned business validation (Core stays generic).
      assertCursorPaired(params);

      // 2. Build a GENERIC binding. BrokerCore knows nothing about these names.
      const query: Record<string, string | number | undefined> = {};
      if (params.limit !== undefined) {
        query.limit = params.limit;
      }
      if (params.afterCreatedAt && params.afterId) {
        query.afterCreatedAt = params.afterCreatedAt;
        query.afterId = params.afterId;
      }

      // 3. Delegate all auth/token/fetch to BrokerCore. Response is passed verbatim.
      const result = await broker.authorizedFetch(
        _ctx,
        WORKFLOW_SUBMISSION_HISTORY_CAPABILITY,
        {
          pathParams: { workflowInstanceId: params.workflowInstanceId },
          query,
        },
      );

      // Normalize the response for model consumption — no field manipulation.
      const responseText = typeof result === 'string'
        ? result
        : JSON.stringify(result);

      return {
        content: [{ type: 'text' as const, text: responseText }],
        details: { capability: WORKFLOW_SUBMISSION_HISTORY_CAPABILITY },
      };
    },
  }) satisfies AgentTool;
}
