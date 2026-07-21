/**
 * PrincipalRegistry — Claim-only Interface Test Suite
 * Uses native Node.js test runner (node:test + node:assert/strict)
 *
 * Tests:
 * 1. claimPrincipal: happy path → returns principalId
 * 2. claimPrincipal: created=true → throws (unexpected new object)
 * 3. claimPrincipal: 409 conflict → throws
 * 4. claimPrincipal: wrong expectedPrincipalId → throws (404 or 409)
 * 5. claimClient: happy path → returns clientId, no secret
 * 6. claimClient: created=true → throws (unexpected new object)
 * 7. claimClient: secret returned → throws (must not leak)
 * 8. claimClient: 409 conflict → throws
 * 9. setBrokerAuth: token obtained before first claim
 * 10. Token reuse: cached token used for multiple claims
 * 11. claimClient: 404 principal not found → throws
 */

import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  PrincipalRegistry,
  ClaimError,
} from '../../src/principal-registry.js';

// ─── Constants ────────────────────────────────────────────────────────────

const AUTH_ORIGIN = 'http://auth-service:4001';
const BROKER_CLIENT_ID = 'mc_broker-test-client';
const BROKER_SECRET = 'broker-test-secret';
const TEST_TOKEN = 'test-v1-rs256-token';

// ─── Helpers ──────────────────────────────────────────────────────────────

function createRegistry(): PrincipalRegistry {
  const registry = new PrincipalRegistry(AUTH_ORIGIN);
  registry.setBrokerAuth(BROKER_CLIENT_ID, BROKER_SECRET);
  return registry;
}

/**
 * Create a mock fetch that returns specific responses.
 * The mock handles:
 * - POST /oauth/token → returns a dummy access token
 * - POST /api/v1/principals → returns configured principal response
 * - POST /api/v1/clients → returns configured client response
 */
function mockFetchWith(options: {
  principalResponse?: { status: number; body: any };
  clientResponse?: { status: number; body: any };
}): void {
  mock.method(global, 'fetch', async (url: string, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url.toString();

    // Token endpoint
    if (urlStr.includes('/oauth/token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: TEST_TOKEN,
          token_type: 'Bearer',
          expires_in: 600,
        }),
        text: async () => JSON.stringify({ access_token: TEST_TOKEN }),
      } as Response;
    }

    // Principal endpoint
    if (urlStr.includes('/api/v1/principals') && init?.method === 'POST') {
      if (options.principalResponse) {
        return {
          ok: options.principalResponse.status < 400,
          status: options.principalResponse.status,
          json: async () => options.principalResponse!.body,
          text: async () => JSON.stringify(options.principalResponse!.body),
        } as Response;
      }
    }

    // Client endpoint
    if (urlStr.includes('/api/v1/clients') && init?.method === 'POST') {
      if (options.clientResponse) {
        return {
          ok: options.clientResponse.status < 400,
          status: options.clientResponse.status,
          json: async () => options.clientResponse!.body,
          text: async () => JSON.stringify(options.clientResponse!.body),
        } as Response;
      }
    }

    // Default: not found
    return {
      ok: false,
      status: 404,
      json: async () => ({ message: 'Not found' }),
      text: async () => 'Not found',
    } as Response;
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('PrincipalRegistry: claimPrincipal', async () => {
  beforeEach(() => {
    mock.reset();
  });

  await it('happy path: claims existing principal, returns principalId', async () => {
    mockFetchWith({
      principalResponse: {
        status: 200,
        body: {
          id: 'b6b033c4-90ba-40aa-a338-304da442cab7',
          principal_type: 'agent',
          display_name: '龙虾合伙人',
          status: 'active',
          external_ref: 'openclaw:agent:ceo-agent',
          created_at: '2026-07-20T00:00:00.000Z',
          created: false,
        },
      },
    });

    const registry = createRegistry();
    const result = await registry.claimPrincipal({
      externalRef: 'openclaw:agent:ceo-agent',
      expectedPrincipalId: 'b6b033c4-90ba-40aa-a338-304da442cab7',
      principalType: 'agent',
      displayName: '龙虾合伙人',
      agentId: 'ceo-agent',
      ownerUserId: '2f6580a0-bdf1-4cac-9260-f28559587010',
    });

    assert.equal(result.principalId, 'b6b033c4-90ba-40aa-a338-304da442cab7');
  });

  await it('created=true → throws ClaimError (unexpected new object)', async () => {
    mockFetchWith({
      principalResponse: {
        status: 201,
        body: {
          id: 'new-uuid-1234',
          principal_type: 'agent',
          created: true,
          external_ref: 'openclaw:agent:new-agent',
        },
      },
    });

    const registry = createRegistry();
    await assert.rejects(
      () => registry.claimPrincipal({
        externalRef: 'openclaw:agent:new-agent',
        expectedPrincipalId: 'b6b033c4-90ba-40aa-a338-304da442cab7',
        principalType: 'agent',
        displayName: 'New Agent',
        agentId: 'new-agent',
        ownerUserId: '2f6580a0-bdf1-4cac-9260-f28559587010',
      }),
      { name: 'ClaimError' },
    );
  });

  await it('409 conflict → throws ClaimError', async () => {
    mockFetchWith({
      principalResponse: {
        status: 409,
        body: { message: 'external_ref is already bound to a different principal' },
      },
    });

    const registry = createRegistry();
    await assert.rejects(
      () => registry.claimPrincipal({
        externalRef: 'openclaw:agent:conflict-agent',
        expectedPrincipalId: '00000000-0000-0000-0000-000000000000',
        principalType: 'agent',
        displayName: 'Conflict',
        agentId: 'conflict-agent',
        ownerUserId: '2f6580a0-bdf1-4cac-9260-f28559587010',
      }),
      { name: 'ClaimError' },
    );
  });

  await it('404 principal not found → throws ClaimError', async () => {
    mockFetchWith({
      principalResponse: {
        status: 404,
        body: { message: 'Principal not found' },
      },
    });

    const registry = createRegistry();
    await assert.rejects(
      () => registry.claimPrincipal({
        externalRef: 'openclaw:agent:phantom-agent',
        expectedPrincipalId: '00000000-0000-0000-0000-000000000000',
        principalType: 'agent',
        displayName: 'Phantom',
        agentId: 'phantom-agent',
        ownerUserId: '2f6580a0-bdf1-4cac-9260-f28559587010',
      }),
      { name: 'ClaimError' },
    );
  });
});

describe('PrincipalRegistry: claimClient', async () => {
  beforeEach(() => {
    mock.reset();
  });

  await it('happy path: claims existing client, returns clientId, no secret', async () => {
    mockFetchWith({
      clientResponse: {
        status: 200,
        body: {
          id: 'client-db-uuid',
          client_id: 'mc_YF72xaymGzGYftmcDb1tr6lt',
          principal_id: 'b6b033c4-90ba-40aa-a338-304da442cab7',
          status: 'active',
          external_ref: 'openclaw:client:b6b033c4-...:runtime-auth',
          created_at: '2026-07-20T00:00:00.000Z',
          created: false,
        },
      },
    });

    const registry = createRegistry();
    const result = await registry.claimClient({
      externalRef: 'openclaw:client:b6b033c4-90ba-40aa-a338-304da442cab7:runtime-auth',
      principalId: 'b6b033c4-90ba-40aa-a338-304da442cab7',
      expectedClientId: 'mc_YF72xaymGzGYftmcDb1tr6lt',
    });

    assert.equal(result.clientId, 'mc_YF72xaymGzGYftmcDb1tr6lt');
  });

  await it('created=true → throws ClaimError (unexpected new client)', async () => {
    mockFetchWith({
      clientResponse: {
        status: 201,
        body: {
          id: 'new-client-db-uuid',
          client_id: 'mc_new-client-1234',
          principal_id: 'b6b033c4-90ba-40aa-a338-304da442cab7',
          created: true,
          secret: 'super-secret-value',
        },
      },
    });

    const registry = createRegistry();
    await assert.rejects(
      () => registry.claimClient({
        externalRef: 'openclaw:client:new:runtime-auth',
        principalId: 'b6b033c4-90ba-40aa-a338-304da442cab7',
        expectedClientId: 'mc_new-client-1234',
      }),
      { name: 'ClaimError' },
    );
  });

  await it('secret returned for existing client → throws ClaimError', async () => {
    mockFetchWith({
      clientResponse: {
        status: 200,
        body: {
          id: 'client-db-uuid',
          client_id: 'mc_YF72xaymGzGYftmcDb1tr6lt',
          principal_id: 'b6b033c4-90ba-40aa-a338-304da442cab7',
          created: false,
          secret: 'leaked-secret-value', // Must never happen
        },
      },
    });

    const registry = createRegistry();
    await assert.rejects(
      () => registry.claimClient({
        externalRef: 'openclaw:client:b6b033c4-...:runtime-auth',
        principalId: 'b6b033c4-90ba-40aa-a338-304da442cab7',
        expectedClientId: 'mc_YF72xaymGzGYftmcDb1tr6lt',
      }),
      { name: 'ClaimError' },
    );
  });

  await it('409 conflict → throws ClaimError', async () => {
    mockFetchWith({
      clientResponse: {
        status: 409,
        body: { message: 'external_ref already bound to another client' },
      },
    });

    const registry = createRegistry();
    await assert.rejects(
      () => registry.claimClient({
        externalRef: 'openclaw:client:conflict:runtime-auth',
        principalId: 'b6b033c4-90ba-40aa-a338-304da442cab7',
        expectedClientId: 'mc_wrong-client',
      }),
      { name: 'ClaimError' },
    );
  });

  await it('404 principal not found → throws ClaimError', async () => {
    mockFetchWith({
      clientResponse: {
        status: 404,
        body: { message: 'MachinePrincipal not found' },
      },
    });

    const registry = createRegistry();
    await assert.rejects(
      () => registry.claimClient({
        externalRef: 'openclaw:client:nonexistent:runtime-auth',
        principalId: '00000000-0000-0000-0000-000000000000',
        expectedClientId: 'mc_nonexistent',
      }),
      { name: 'ClaimError' },
    );
  });
});

describe('PrincipalRegistry: broker auth', async () => {
  beforeEach(() => {
    mock.reset();
  });

  await it('setBrokerAuth obtains token before first claim', async () => {
    let tokenRequested = false;

    mock.method(global, 'fetch', async (url: string, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString();

      if (urlStr.includes('/oauth/token')) {
        tokenRequested = true;
        // Verify basic auth header
        const authHeader = (init?.headers as Record<string, string>)?.['Authorization'] || '';
        assert.ok(authHeader.startsWith('Basic '), 'Must use Basic auth for token endpoint');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'fresh-test-token',
            expires_in: 600,
          }),
          text: async () => JSON.stringify({ access_token: 'fresh-test-token' }),
        } as Response;
      }

      if (urlStr.includes('/api/v1/principals')) {
        assert.ok(tokenRequested, 'Token must be obtained before API call');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'test-principal-id',
            created: false,
          }),
          text: async () => JSON.stringify({ id: 'test-principal-id', created: false }),
        } as Response;
      }

      return { ok: false, status: 404, json: async () => ({}), text: async () => 'Not found' } as Response;
    });

    const registry = createRegistry();
    const result = await registry.claimPrincipal({
      externalRef: 'openclaw:agent:test-agent',
      expectedPrincipalId: 'test-principal-id',
      principalType: 'agent',
      displayName: 'Test',
      agentId: 'test-agent',
      ownerUserId: '2f6580a0-bdf1-4cac-9260-f28559587010',
    });

    assert.ok(tokenRequested, 'Token endpoint was called');
    assert.equal(result.principalId, 'test-principal-id');
  });

  await it('cached token reused for multiple claims', async () => {
    let tokenCalls = 0;

    mock.method(global, 'fetch', async (url: string, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString();

      if (urlStr.includes('/oauth/token')) {
        tokenCalls++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'reused-token',
            expires_in: 600,
          }),
          text: async () => JSON.stringify({ access_token: 'reused-token' }),
        } as Response;
      }

      if (urlStr.includes('/api/v1/principals')) {
        // Return response matching the expectedPrincipalId from the request body
        const body = JSON.parse((init?.body as string) || '{}');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: body.expected_principal_id,
            created: false,
          }),
          text: async () => JSON.stringify({ id: body.expected_principal_id, created: false }),
        } as Response;
      }

      if (urlStr.includes('/api/v1/clients')) {
        const body = JSON.parse((init?.body as string) || '{}');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'client-db-id',
            client_id: body.expected_client_id,
            created: false,
          }),
          text: async () => JSON.stringify({ id: 'client-db-id', client_id: body.expected_client_id, created: false }),
        } as Response;
      }

      return { ok: false, status: 404, json: async () => ({}), text: async () => 'Not found' } as Response;
    });

    const registry = createRegistry();

    // First claim → gets token
    await registry.claimPrincipal({
      externalRef: 'openclaw:agent:agent-a',
      expectedPrincipalId: 'principal-a',
      principalType: 'agent',
      displayName: 'Agent A',
      agentId: 'agent-a',
      ownerUserId: '2f6580a0-bdf1-4cac-9260-f28559587010',
    });

    // Second claim → reuses token
    await registry.claimClient({
      externalRef: 'openclaw:client:principal-a:runtime-auth',
      principalId: 'principal-a',
      expectedClientId: 'mc_test-client',
    });

    // Third claim → still reuses token
    await registry.claimPrincipal({
      externalRef: 'openclaw:agent:agent-b',
      expectedPrincipalId: 'principal-b',
      principalType: 'agent',
      displayName: 'Agent B',
      agentId: 'agent-b',
      ownerUserId: '2f6580a0-bdf1-4cac-9260-f28559587010',
    });

    assert.equal(tokenCalls, 1, 'Token should be fetched exactly once for multiple claims');
  });

  await it('throws AuthTokenError if setBrokerAuth not called', async () => {
    const registry = new PrincipalRegistry(AUTH_ORIGIN);
    // Don't call setBrokerAuth

    await assert.rejects(
      () => registry.claimPrincipal({
        externalRef: 'openclaw:agent:test',
        expectedPrincipalId: 'test-id',
        principalType: 'agent',
        displayName: 'Test',
        agentId: 'test',
        ownerUserId: '2f6580a0-bdf1-4cac-9260-f28559587010',
      }),
      { name: 'AuthTokenError' },
    );
  });
});

describe('PrincipalRegistry: error responses', async () => {
  beforeEach(() => {
    mock.reset();
  });

  await it('unexpected principal ID in response → throws ClaimError', async () => {
    mockFetchWith({
      principalResponse: {
        status: 200,
        body: {
          id: 'wrong-uuid-1234',
          created: false,
        },
      },
    });

    const registry = createRegistry();
    await assert.rejects(
      () => registry.claimPrincipal({
        externalRef: 'openclaw:agent:test',
        expectedPrincipalId: 'expected-uuid-5678',
        principalType: 'agent',
        displayName: 'Test',
        agentId: 'test',
        ownerUserId: '2f6580a0-bdf1-4cac-9260-f28559587010',
      }),
      { name: 'ClaimError' },
    );
  });

  await it('network error during token acquisition → throws AuthTokenError', async () => {
    mock.method(global, 'fetch', async () => {
      throw new Error('ECONNREFUSED');
    });

    const registry = createRegistry();
    await assert.rejects(
      () => registry.claimPrincipal({
        externalRef: 'openclaw:agent:test',
        expectedPrincipalId: 'test-id',
        principalType: 'agent',
        displayName: 'Test',
        agentId: 'test',
        ownerUserId: '2f6580a0-bdf1-4cac-9260-f28559587010',
      }),
      { name: 'AuthTokenError' },
    );
  });
});
