/**
 * workflow_submission_history — Unit Tests
 *
 * Coverage matrix (aligned with the delivery spec):
 *
 * Business correctness:
 *   VALID_INSTANCE_RETURNS_HISTORY
 *   RETURN_SUBMISSION_PAYLOAD_VISIBLE
 *   PAYLOAD_DIGEST_PRESERVED
 *   BROKER_DOES_NOT_DROP_FIELDS
 *
 * Input validation (Adapter-owned):
 *   INVALID_INSTANCE_ID_REJECTED
 *   HALF_CURSOR_REJECTED            (400 input error, NOT 401)
 *   LIMIT_OVER_100_REJECTED
 *   ACTOR_OVERRIDE_NOT_SUPPORTED
 *   TOKEN_OVERRIDE_NOT_SUPPORTED
 *
 * Generic core binding (BrokerCore-owned, no business knowledge):
 *   EXISTING_FIXED_PATH_GET_UNCHANGED
 *   UNDECLARED_PATH_PLACEHOLDER_REJECTED
 *   MISSING_PATH_PARAM_REJECTED
 *   EXTRA_PATH_PARAM_REJECTED
 *   PATH_PARAM_PERCENT_ENCODED
 *   QUERY_UNDEFINED_VALUES_OMITTED
 *   EXISTING_RETRY_AND_TOKEN_CACHE_REUSED
 *
 * Fail-closed / security:
 *   NO_TOKEN_MAPPING_FAILS_CLOSED
 *   CROSS_DOMAIN_FAILS_CLOSED
 *
 * Tests mock global.fetch (token endpoint + business endpoint) and inject a
 * fake secret resolver, mirroring principal-registry.test.ts patterns.
 */

import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  Registries,
  type BrokerPluginConfig,
  AgentNotAllowedError as RegistriesAgentNotAllowedError,
} from '../../src/registries.js';
import {
  BrokerCore,
  BrokerError,
  RequestBindingError,
} from '../../src/broker-core.js';
import { setSecretResolver } from '../../src/secret-resolver.js';
import {
  createWorkflowSubmissionHistoryTool,
  WORKFLOW_SUBMISSION_HISTORY_CAPABILITY,
  WorkflowSubmissionHistorySchema,
} from '../../src/adapters/workflow-submission-history.js';
import { createWorkflowTasksTool } from '../../src/adapters/workflow-tasks.js';
import type { OpenClawPluginToolContext } from '../../src/plugin-api.js';

// ─── Constants / Fixtures ─────────────────────────────────────────────────

const AUTH_ORIGIN = 'http://auth-service:4001';
const WORKFLOW_ORIGIN = 'http://svc-workflow:8989';
const TEST_TOKEN = 'test-rs256-access-token';
const SAFE_INSTANCE = '51a89879-d376-4a32-9664-ba7dda9b450b';
const AGENT_ID = 'paper-reviewer-agent';
const CLIENT_ID = 'mc_paper_reviewer';
const OTHER_AUDIENCE_ORIGIN = 'http://svc-other:9999';

const BASE_CONFIG: BrokerPluginConfig = {
  globalEnabled: true,
  enabledAgentIds: [AGENT_ID],
  agentClients: {
    [AGENT_ID]: {
      clientId: CLIENT_ID,
      credentialRef: { source: 'env', provider: 'os', id: 'PAPER_REVIEWER_SECRET' },
    },
  },
  targets: [
    { targetId: 'svc-workflow', audience: 'svc-workflow', allowedOrigin: WORKFLOW_ORIGIN },
    { targetId: 'svc-other', audience: 'svc-other', allowedOrigin: OTHER_AUDIENCE_ORIGIN },
  ],
  capabilities: [
    {
      capabilityId: WORKFLOW_SUBMISSION_HISTORY_CAPABILITY,
      targetId: 'svc-workflow',
      requiredScopes: ['workflow.read'],
      method: 'GET',
      path: '/internal/v1/workflow-instances/{workflowInstanceId}/submissions',
    },
    {
      capabilityId: 'workflow_my_tasks',
      targetId: 'svc-workflow',
      requiredScopes: ['workflow.read'],
      method: 'GET',
      path: '/internal/v1/worklists/assigned-to-me',
    },
  ],
  authServiceOrigin: AUTH_ORIGIN,
};

/** A representative svc-workflow submission-history body (shape only, not real data). */
const SUBMISSION_HISTORY_BODY = {
  items: [
    {
      submission_id: '00000000-0000-4000-8000-000000000001',
      transition_key: 'return',
      transition_effect: 'RETURN',
      author_principal_id: '11111111-1111-4111-8111-111111111111',
      payload: { reason: 'needs revision', note: 'please address reviewer comments' },
      payload_digest: 'sha256:abcdef0123456789',
      created_at: '2026-07-15T10:00:00.000Z',
      source_node: 'review',
    },
  ],
  next_cursor: 'cursor-token-xyz',
};

function makeCtx(agentId: string = AGENT_ID): OpenClawPluginToolContext {
  return { agentId };
}

/**
 * Mock global.fetch with branches:
 *  - POST /oauth/token → 200 access_token
 *  - GET .../submissions → configurable response (default: the history body)
 */
function mockFetchWith(options: {
  submissionsStatus?: number;
  submissionsBody?: unknown;
  tokenCalls?: { count: number };
  submissionCalls?: { urls: string[]; count: number };
  worklistCalls?: { urls: string[]; count: number };
}): void {
  const submissionsStatus = options.submissionsStatus ?? 200;
  const submissionsBody = options.submissionsBody ?? SUBMISSION_HISTORY_BODY;
  const tokenCalls = options.tokenCalls ?? { count: 0 };
  const submissionCalls = options.submissionCalls ?? { urls: [] as string[], count: 0 };
  const worklistCalls = options.worklistCalls ?? { urls: [] as string[], count: 0 };

  mock.method(global, 'fetch', async (url: string | URL, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url.toString();

    // Token endpoint
    if (urlStr.includes('/oauth/token')) {
      tokenCalls.count += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: TEST_TOKEN, token_type: 'Bearer', expires_in: 600 }),
        text: async () => JSON.stringify({ access_token: TEST_TOKEN }),
      } as Response;
    }

    // Business endpoint — submissions
    if (urlStr.includes('/submissions')) {
      submissionCalls.urls.push(urlStr);
      submissionCalls.count += 1;
      return {
        ok: submissionsStatus >= 200 && submissionsStatus < 300,
        status: submissionsStatus,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => submissionsBody,
        text: async () => JSON.stringify(submissionsBody),
      } as Response;
    }

    // worklist (workflow_my_tasks) — fixed path, returns a minimal body
    if (urlStr.includes('/worklists/assigned-to-me')) {
      worklistCalls.urls.push(urlStr);
      worklistCalls.count += 1;
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ items: [], next_cursor: null }),
        text: async () => JSON.stringify({ items: [], next_cursor: null }),
      } as Response;
    }

    return {
      ok: false,
      status: 404,
      headers: new Headers(),
      json: async () => ({ message: 'Not found' }),
      text: async () => 'Not found',
    } as Response;
  });
}

function makeBroker(config: BrokerPluginConfig = BASE_CONFIG): BrokerCore {
  return new BrokerCore(new Registries(config));
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('workflow_submission_history', () => {
  beforeEach(() => {
    mock.reset();
    // Inject a fake secret resolver so no env/file reads happen.
    setSecretResolver(async () => 'fake-secret');
  });
  afterEach(() => {
    mock.reset();
    setSecretResolver(null);
  });

  // ── Business correctness ──────────────────────────────────────────────
  describe('business correctness', () => {
    it('VALID_INSTANCE_RETURNS_HISTORY: valid UUID returns submission history', async () => {
      const tokenCalls = { count: 0 };
      const subCalls = { urls: [] as string[], count: 0 };
      mockFetchWith({ tokenCalls, submissionCalls: subCalls });

      const broker = makeBroker();
      const toolFactory = createWorkflowSubmissionHistoryTool(broker);
      const tool = toolFactory(makeCtx());

      const result = await tool.execute('call-1', { workflowInstanceId: SAFE_INSTANCE });
      const parsed = JSON.parse(result.content[0].text);

      assert.deepEqual(parsed, SUBMISSION_HISTORY_BODY);
      // Path interpolation happened correctly
      assert.ok(subCalls.urls[0].includes(`/workflow-instances/${SAFE_INSTANCE}/submissions`));
      // No query string when no optional params provided
      assert.ok(!subCalls.urls[0].includes('?'), 'no query string expected');
      // Token issued exactly once (cache reused)
      assert.equal(tokenCalls.count, 1);
    });

    it('RETURN_SUBMISSION_PAYLOAD_VISIBLE: payload field preserved in response', async () => {
      mockFetchWith({});
      const broker = makeBroker();
      const tool = createWorkflowSubmissionHistoryTool(broker)(makeCtx());
      const result = await tool.execute('call-1', { workflowInstanceId: SAFE_INSTANCE });
      const parsed = JSON.parse(result.content[0].text);
      assert.deepEqual(parsed.items[0].payload, SUBMISSION_HISTORY_BODY.items[0].payload);
    });

    it('PAYLOAD_DIGEST_PRESERVED: payload_digest field preserved verbatim', async () => {
      mockFetchWith({});
      const broker = makeBroker();
      const tool = createWorkflowSubmissionHistoryTool(broker)(makeCtx());
      const result = await tool.execute('call-1', { workflowInstanceId: SAFE_INSTANCE });
      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.items[0].payload_digest, 'sha256:abcdef0123456789');
    });

    it('BROKER_DOES_NOT_DROP_FIELDS: returned JSON deep-equals mock body', async () => {
      mockFetchWith({});
      const broker = makeBroker();
      const tool = createWorkflowSubmissionHistoryTool(broker)(makeCtx());
      const result = await tool.execute('call-1', { workflowInstanceId: SAFE_INSTANCE });
      const parsed = JSON.parse(result.content[0].text);
      assert.deepEqual(parsed, SUBMISSION_HISTORY_BODY);
    });

    it('query params are appended only when provided', async () => {
      const subCalls = { urls: [] as string[], count: 0 };
      mockFetchWith({ submissionCalls: subCalls });
      const broker = makeBroker();
      const tool = createWorkflowSubmissionHistoryTool(broker)(makeCtx());

      await tool.execute('call-1', {
        workflowInstanceId: SAFE_INSTANCE,
        limit: 25,
        afterCreatedAt: '2026-07-15T10:00:00.000Z',
        afterId: '00000000-0000-4000-8000-000000000002',
      });

      const url = subCalls.urls[0];
      assert.ok(url.includes(`workflow-instances/${SAFE_INSTANCE}/submissions?`));
      assert.ok(url.includes('limit=25'));
      assert.ok(url.includes('afterCreatedAt=2026-07-15T10%3A00%3A00.000Z'));
      assert.ok(url.includes('afterId=00000000-0000-4000-8000-000000000002'));
    });
  });

  // ── Input validation (Adapter-owned) ──────────────────────────────────
  describe('input validation (adapter-owned)', () => {
    it('INVALID_INSTANCE_ID_REJECTED: schema enforces UUID pattern on workflowInstanceId', () => {
      // Structural check: the workflowInstanceId property carries a UUID pattern
      // (the pattern string itself contains the hex-group markers {8}-{4}-{4}-{4}-{12}).
      const idProp = (WorkflowSubmissionHistorySchema as any).properties.workflowInstanceId;
      assert.ok(idProp, 'workflowInstanceId property exists');
      assert.ok(typeof idProp.pattern === 'string' && idProp.pattern.length > 0, 'has a pattern');
      assert.match(idProp.pattern, /\{8\}-.*\{4\}-.*\{4\}-.*\{4\}-.*\{12\}/, 'UUID group pattern enforced');
      // afterId (if present) is also UUID-constrained.
      const afterIdProp = (WorkflowSubmissionHistorySchema as any).properties.afterId;
      if (afterIdProp) {
        assert.match(afterIdProp.pattern, /\{8\}-.*\{4\}-.*\{4\}-.*\{4\}-.*\{12\}/);
      }
    });

    it('INVALID_INSTANCE_ID_REJECTED: Core percent-encodes any path value (transport safety)', async () => {
      const subCalls = { urls: [] as string[], count: 0 };
      mockFetchWith({ submissionCalls: subCalls });
      const broker = makeBroker();
      // Bypass schema (which enforces UUID) to probe transport-level safety:
      // Core must percent-encode so path traversal never reaches the URL raw.
      await broker.authorizedFetch(
        makeCtx(),
        WORKFLOW_SUBMISSION_HISTORY_CAPABILITY,
        { pathParams: { workflowInstanceId: '../escape' } },
      );
      assert.ok(subCalls.urls[0].includes('..%2Fescape'));
      assert.ok(!subCalls.urls[0].includes('/../'));
    });

    it('HALF_CURSOR_REJECTED: only afterCreatedAt → 400 input error, NOT 401', async () => {
      mockFetchWith({});
      const broker = makeBroker();
      const tool = createWorkflowSubmissionHistoryTool(broker)(makeCtx());

      // Adapter throws RequestBindingError (400) — a client input error, NOT auth.
      await assert.rejects(
        () => tool.execute('call-1', { workflowInstanceId: SAFE_INSTANCE, afterCreatedAt: '2026-07-15T10:00:00.000Z' }),
        (err: unknown) => {
          assert.ok(err instanceof RequestBindingError, 'should be RequestBindingError');
          assert.equal((err as RequestBindingError).statusCode, 400);
          // Must NOT be an auth/allowlist failure.
          assert.notEqual((err as Error).name, 'AgentNotAllowedError');
          return true;
        },
      );
    });

    it('HALF_CURSOR_REJECTED: only afterId → 400 input error', async () => {
      mockFetchWith({});
      const broker = makeBroker();
      const tool = createWorkflowSubmissionHistoryTool(broker)(makeCtx());
      await assert.rejects(
        () => tool.execute('call-1', {
          workflowInstanceId: SAFE_INSTANCE,
          afterId: '00000000-0000-4000-8000-000000000003',
        }),
        (err: unknown) => {
          assert.ok(err instanceof RequestBindingError);
          assert.equal((err as RequestBindingError).statusCode, 400);
          return true;
        },
      );
    });

    it('LIMIT_OVER_100_REJECTED: schema enforces maximum=100', () => {
      // svc-workflow accepts max 100; schema must not permit above it.
      const limitProp = (WorkflowSubmissionHistorySchema as any).properties.limit;
      assert.ok(limitProp, 'limit property exists');
      assert.equal(limitProp.maximum, 100, 'limit maximum must be 100');
      assert.ok(limitProp.minimum >= 1, 'limit minimum >= 1');
    });

    it('ACTOR_OVERRIDE_NOT_SUPPORTED: schema has additionalProperties:false and no actorPrincipalId field', () => {
      assert.equal((WorkflowSubmissionHistorySchema as any).additionalProperties, false);
      const propKeys = Object.keys((WorkflowSubmissionHistorySchema as any).properties);
      assert.ok(!propKeys.includes('actorPrincipalId'), 'no actorPrincipalId field');
    });

    it('TOKEN_OVERRIDE_NOT_SUPPORTED: no Authorization/token field accepted', () => {
      const propKeys = Object.keys((WorkflowSubmissionHistorySchema as any).properties);
      assert.ok(!propKeys.some(k => k.toLowerCase() === 'authorization'), 'no authorization field');
      assert.ok(!propKeys.includes('token'), 'no token field');
    });
  });

  // ── Generic core binding (BrokerCore-owned) ───────────────────────────
  describe('generic core binding', () => {
    it('EXISTING_FIXED_PATH_GET_UNCHANGED: workflow_my_tasks still works with empty binding', async () => {
      const worklistCalls = { urls: [] as string[], count: 0 };
      mockFetchWith({ worklistCalls });
      const broker = makeBroker();
      const tool = createWorkflowTasksTool(broker)(makeCtx());
      const result = await tool.execute('call-1', {});

      const parsed = JSON.parse(result.content[0].text);
      assert.deepEqual(parsed, { items: [], next_cursor: null });
      // Fixed path, no placeholder, no query
      assert.ok(worklistCalls.urls[0].endsWith('/internal/v1/worklists/assigned-to-me'));
      assert.ok(!worklistCalls.urls[0].includes('?'));
    });

    it('UNDECLARED_PATH_PLACEHOLDER_REJECTED: placeholder present but pathParams missing', async () => {
      mockFetchWith({});
      const broker = makeBroker();
      await assert.rejects(
        () => broker.authorizedFetch(makeCtx(), WORKFLOW_SUBMISSION_HISTORY_CAPABILITY, {}),
        (err: unknown) => {
          assert.ok(err instanceof RequestBindingError);
          assert.match((err as Error).message, /missing path parameter "workflowInstanceId"/);
          return true;
        },
      );
    });

    it('MISSING_PATH_PARAM_REJECTED: partial pathParams', async () => {
      mockFetchWith({});
      const broker = makeBroker();
      // A capability with two placeholders
      const cfg: BrokerPluginConfig = {
        ...BASE_CONFIG,
        capabilities: [
          {
            capabilityId: 'two_param_cap',
            targetId: 'svc-workflow',
            requiredScopes: ['workflow.read'],
            method: 'GET',
            path: '/a/{x}/b/{y}',
          },
        ],
      };
      const b = makeBroker(cfg);
      await assert.rejects(
        () => b.authorizedFetch(makeCtx(), 'two_param_cap', { pathParams: { x: '1' } }),
        (err: unknown) => {
          assert.ok(err instanceof RequestBindingError);
          assert.match((err as Error).message, /missing path parameter "y"/);
          return true;
        },
      );
    });

    it('EXTRA_PATH_PARAM_REJECTED: extra pathParams not in template', async () => {
      mockFetchWith({});
      const broker = makeBroker();
      await assert.rejects(
        () => broker.authorizedFetch(
          makeCtx(),
          WORKFLOW_SUBMISSION_HISTORY_CAPABILITY,
          { pathParams: { workflowInstanceId: SAFE_INSTANCE, rogue: 'no' } },
        ),
        (err: unknown) => {
          assert.ok(err instanceof RequestBindingError);
          assert.match((err as Error).message, /undeclared path parameter "rogue"/);
          return true;
        },
      );
    });

    it('PATH_PARAM_PERCENT_ENCODED: special chars are encoded', async () => {
      const subCalls = { urls: [] as string[], count: 0 };
      mockFetchWith({ submissionCalls: subCalls });
      const broker = makeBroker();
      // Inject a value with special chars directly through Core (transport only).
      await broker.authorizedFetch(
        makeCtx(),
        WORKFLOW_SUBMISSION_HISTORY_CAPABILITY,
        { pathParams: { workflowInstanceId: 'a b/c?d' } },
      );
      assert.ok(subCalls.urls[0].includes('a%20b%2Fc%3Fd'));
      assert.ok(!subCalls.urls[0].includes('a b/c?d'));
    });

    it('QUERY_UNDEFINED_VALUES_OMITTED: undefined/empty query entries are dropped', async () => {
      const subCalls = { urls: [] as string[], count: 0 };
      mockFetchWith({ submissionCalls: subCalls });
      const broker = makeBroker();
      await broker.authorizedFetch(
        makeCtx(),
        WORKFLOW_SUBMISSION_HISTORY_CAPABILITY,
        {
          pathParams: { workflowInstanceId: SAFE_INSTANCE },
          query: { limit: undefined, empty: '', present: 'yes' },
        },
      );
      const url = subCalls.urls[0];
      assert.ok(url.includes('present=yes'));
      assert.ok(!url.includes('limit='));
      assert.ok(!url.includes('empty='));
    });

    it('EXISTING_RETRY_AND_TOKEN_CACHE_REUSED: 401 triggers one retry + cached token', async () => {
      const tokenCalls = { count: 0 };
      const subCalls = { urls: [] as string[], count: 0 };
      let firstAttempt = true;
      mock.method(global, 'fetch', async (url: string | URL, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('/oauth/token')) {
          tokenCalls.count += 1;
          return {
            ok: true,
            status: 200,
            json: async () => ({ access_token: TEST_TOKEN, token_type: 'Bearer', expires_in: 600 }),
            text: async () => '',
          } as Response;
        }
        if (urlStr.includes('/submissions')) {
          subCalls.urls.push(urlStr);
          subCalls.count += 1;
          if (firstAttempt) {
            firstAttempt = false;
            return {
              ok: false,
              status: 401,
              headers: new Headers({ 'content-type': 'application/json' }),
              json: async () => ({ message: 'unauthorized' }),
              text: async () => 'unauthorized',
            } as Response;
          }
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => SUBMISSION_HISTORY_BODY,
            text: async () => JSON.stringify(SUBMISSION_HISTORY_BODY),
          } as Response;
        }
        return { ok: false, status: 404, headers: new Headers(), json: async () => ({}), text: async () => '' } as Response;
      });

      const broker = makeBroker();
      const result = await broker.authorizedFetch(
        makeCtx(),
        WORKFLOW_SUBMISSION_HISTORY_CAPABILITY,
        { pathParams: { workflowInstanceId: SAFE_INSTANCE } },
      );

      assert.deepEqual(result, SUBMISSION_HISTORY_BODY);
      assert.equal(subCalls.count, 2, 'business endpoint called twice (initial + retry)');
      assert.equal(tokenCalls.count, 2, 'token re-issued once after 401 invalidation');
    });
  });

  // ── Fail-closed / security ────────────────────────────────────────────
  describe('fail-closed / security', () => {
    it('NO_TOKEN_MAPPING_FAILS_CLOSED: unknown agent → AgentNotAllowedError', async () => {
      mockFetchWith({});
      const broker = makeBroker();
      await assert.rejects(
        () => broker.authorizedFetch(
          makeCtx('not-in-allowlist-agent'),
          WORKFLOW_SUBMISSION_HISTORY_CAPABILITY,
          { pathParams: { workflowInstanceId: SAFE_INSTANCE } },
        ),
        RegistriesAgentNotAllowedError,
      );
    });

    it('CROSS_DOMAIN_FAILS_CLOSED: svc-workflow 404 → BrokerError(404), NOT empty list', async () => {
      mockFetchWith({ submissionsStatus: 404, submissionsBody: { message: 'instance not visible' } });
      const broker = makeBroker();
      await assert.rejects(
        () => broker.authorizedFetch(
          makeCtx(),
          WORKFLOW_SUBMISSION_HISTORY_CAPABILITY,
          { pathParams: { workflowInstanceId: SAFE_INSTANCE } },
        ),
        (err: unknown) => {
          assert.ok(err instanceof BrokerError);
          assert.equal((err as BrokerError).statusCode, 404);
          // The error must NOT be converted to an empty list / swallowed.
          assert.match((err as Error).message, /404/);
          return true;
        },
      );
    });
  });
});
