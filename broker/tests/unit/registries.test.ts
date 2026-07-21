/**
 * Registries Unit Tests
 *
 * Covers:
 * - Config validation (pass/fail)
 * - Agent allowlist gate
 * - Client lookup
 * - Target lookup
 * - Capability lookup
 * - Error cases for each registry
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  Registries,
  BrokerPluginConfig,
  AgentNotAllowedError,
  AgentClientNotFoundError,
  UnknownTargetError,
  UnknownCapabilityError,
  ConfigValidationError,
} from '../../src/registries.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────

const VALID_CONFIG: BrokerPluginConfig = {
  globalEnabled: true,
  enabledAgentIds: ['auth-canary-agent'],
  agentClients: {
    'auth-canary-agent': {
      clientId: 'openclaw-auth-canary-agent',
      credentialRef: { source: 'env', provider: 'os', id: 'AUTH_CANARY_SECRET' },
    },
  },
  targets: [
    { targetId: 'svc-workflow', audience: 'svc-workflow', allowedOrigin: 'https://workflow.example.com' },
    { targetId: 'test-service', audience: 'test-service', allowedOrigin: 'http://localhost:9999' },
  ],
  capabilities: [
    { capabilityId: 'workflow_my_tasks', targetId: 'svc-workflow', requiredScopes: ['workflow.read'], method: 'GET', path: '/api/v1/my-tasks' },
    { capabilityId: 'test_read', targetId: 'test-service', requiredScopes: ['test.read'], method: 'GET', path: '/api/v1/data' },
  ],
};

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Registries', () => {
  describe('config validation', () => {
    it('accepts valid config', () => {
      assert.doesNotThrow(() => new Registries(VALID_CONFIG));
    });

    it('throws on missing globalEnabled', () => {
      const invalid = { ...VALID_CONFIG, globalEnabled: undefined as any };
      assert.throws(() => new Registries(invalid), ConfigValidationError);
    });

    it('throws on non-array enabledAgentIds', () => {
      const invalid = { ...VALID_CONFIG, enabledAgentIds: 'auth-canary-agent' as any };
      assert.throws(() => new Registries(invalid), ConfigValidationError);
    });

    it('throws on null agentClients', () => {
      const invalid = { ...VALID_CONFIG, agentClients: null as any };
      assert.throws(() => new Registries(invalid), ConfigValidationError);
    });

    it('throws on capability referencing unknown target', () => {
      const invalid = {
        ...VALID_CONFIG,
        capabilities: [
          { capabilityId: 'bad_cap', targetId: 'nonexistent-target', requiredScopes: ['x'], method: 'GET' as const, path: '/' },
        ],
      };
      assert.throws(() => new Registries(invalid), ConfigValidationError);
    });

    it('accepts empty enabledAgentIds (no canary agents)', () => {
      const config = { ...VALID_CONFIG, enabledAgentIds: [] };
      assert.doesNotThrow(() => new Registries(config));
    });
  });

  describe('agent allowlist', () => {
    it('allows configured agent', () => {
      const reg = new Registries(VALID_CONFIG);
      assert.doesNotThrow(() => reg.assertAgentAllowed('auth-canary-agent'));
    });

    it('rejects unconfigured agent', () => {
      const reg = new Registries(VALID_CONFIG);
      assert.throws(() => reg.assertAgentAllowed('other-agent'), AgentNotAllowedError);
    });

    it('rejects empty/undefined agentId', () => {
      const reg = new Registries(VALID_CONFIG);
      assert.throws(() => reg.assertAgentAllowed(''), AgentNotAllowedError);
    });
  });

  describe('agent client lookup', () => {
    it('returns client config for configured agent', () => {
      const reg = new Registries(VALID_CONFIG);
      const client = reg.getAgentClient('auth-canary-agent');
      assert.equal(client.clientId, 'openclaw-auth-canary-agent');
      assert.equal(client.credentialRef.source, 'env');
    });

    it('throws for unconfigured agent', () => {
      const reg = new Registries(VALID_CONFIG);
      assert.throws(() => reg.getAgentClient('other-agent'), AgentClientNotFoundError);
    });

    it('hasAgentClient returns correct boolean', () => {
      const reg = new Registries(VALID_CONFIG);
      assert.equal(reg.hasAgentClient('auth-canary-agent'), true);
      assert.equal(reg.hasAgentClient('other-agent'), false);
    });
  });

  describe('target lookup', () => {
    it('returns target for valid targetId', () => {
      const reg = new Registries(VALID_CONFIG);
      const target = reg.getTarget('svc-workflow');
      assert.equal(target.audience, 'svc-workflow');
      assert.equal(target.allowedOrigin, 'https://workflow.example.com');
    });

    it('throws for unknown targetId', () => {
      const reg = new Registries(VALID_CONFIG);
      assert.throws(() => reg.getTarget('unknown-target'), UnknownTargetError);
    });
  });

  describe('capability lookup', () => {
    it('returns capability for valid capabilityId', () => {
      const reg = new Registries(VALID_CONFIG);
      const cap = reg.getCapability('workflow_my_tasks');
      assert.equal(cap.targetId, 'svc-workflow');
      assert.deepEqual(cap.requiredScopes, ['workflow.read']);
      assert.equal(cap.method, 'GET');
    });

    it('throws for unknown capabilityId', () => {
      const reg = new Registries(VALID_CONFIG);
      assert.throws(() => reg.getCapability('unknown-cap'), UnknownCapabilityError);
    });
  });

  describe('helper properties', () => {
    it('authServiceOrigin returns configured origin', () => {
      const reg = new Registries(VALID_CONFIG);
      assert.equal(reg.authServiceOrigin, 'http://localhost:4982');
    });

    it('authServiceOrigin strips trailing slash', () => {
      const conf = { ...VALID_CONFIG, authServiceOrigin: 'http://test.com/' };
      const reg = new Registries(conf);
      assert.equal(reg.authServiceOrigin, 'http://test.com');
    });

    it('enabledAgentIds returns the allowlist', () => {
      const reg = new Registries(VALID_CONFIG);
      assert.deepEqual(reg.enabledAgentIds, ['auth-canary-agent']);
    });
  });
});
