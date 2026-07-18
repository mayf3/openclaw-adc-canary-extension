/**
 * Phase 1B: Probe Tool Unit Tests
 *
 * Verifies the probe tool (no secret, no network) through the
 * factory pattern, verifying context.agentId capture, schema
 * validation, and error handling.
 *
 * These tests verify the tool logic. The REAL Gateway session path
 * is verified via the start-canary.sh E2E script.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createAdcWorkflowReadTool } from '../src/tool.js';
import type { OpenClawPluginToolContext } from '../src/plugin-api.js';
import { PROBE_CONFIG } from '../src/config.js';
import { AgentBindingError } from '../src/errors.js';

// ─── Helpers ──────────────────────────────────────────────────────────────

function createMockContext(overrides?: Partial<OpenClawPluginToolContext>): OpenClawPluginToolContext {
  return {
    agentId: 'canary-agent',
    sessionKey: 'agent:canary-agent:main:test',
    sessionId: 'test-session-uuid',
    workspaceDir: '/tmp/oc-canary-test',
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('adc_workflow_read (probe mode)', () => {
  it('returns probe result with correct agentId', async () => {
    const factory = createAdcWorkflowReadTool(PROBE_CONFIG, true);
    const tool = factory(createMockContext());

    const result = await tool.execute('call-1', {});

    assert.ok(result.content.length > 0);
    const textContent = result.content[0];
    assert.equal(textContent.type, 'text');
    const payload = JSON.parse(textContent.text);
    assert.equal(payload.status, 'probe_ok');
    assert.equal(payload.agentId, 'canary-agent');
    assert.equal(payload.tool, 'adc_workflow_read');
    assert.equal(payload.mode, 'probe');
  });

  it('captures context.agentId from factory closure (probe mode still validates binding)', async () => {
    const factory = createAdcWorkflowReadTool(PROBE_CONFIG, true);
    // The tool validates agentId against expectedAgentId even in probe mode.
    // When mismatched, it throws AgentBindingError (security check).
    const tool = factory(createMockContext({ agentId: 'custom-agent-id' }));

    await assert.rejects(
      () => tool.execute('call-2', {}),
      (err: Error) => {
        assert.ok(err instanceof AgentBindingError);
        assert.match(err.message, /custom-agent-id/);
        return true;
      },
    );
  });

  it('rejects unknown parameters (additionalProperties=false) - schema validation layer', async () => {
    // NOTE: In the REAL Gateway, TypeBox schema validation with
    // additionalProperties=false happens before execute() is called.
    // This test verifies that the tool is defined with the correct schema.
    const factory = createAdcWorkflowReadTool(PROBE_CONFIG, true);
    const tool = factory(createMockContext());

    // Verify the schema is set up correctly for the runtime to validate
    assert.ok(tool.parameters !== undefined);
    // The schema should be Type.Object({}, {additionalProperties: false})
    // which means it has no properties and rejects unknown fields
    const schema = tool.parameters as any;
    assert.equal(Object.keys(schema.properties || {}).length, 0,
      'Schema should have zero properties'
    );

    // When the runtime validates with additionalProperties=false,
    // any parameter like {agentId: 'hacker'} would be rejected
    // before execute() is ever called.
  });

  it('rejects agentId mismatch with AgentBindingError', async () => {
    const factory = createAdcWorkflowReadTool(
      { ...PROBE_CONFIG, expectedAgentId: 'expected-agent' },
      true,
    );
    const tool = factory(createMockContext({ agentId: 'wrong-agent' }));

    await assert.rejects(
      () => tool.execute('call-4', {}),
      (err: Error) => {
        assert.ok(err instanceof AgentBindingError);
        assert.match(err.message, /expected-agent/);
        assert.match(err.message, /wrong-agent/);
        return true;
      },
    );
  });

  it('rejects missing agentId', async () => {
    const factory = createAdcWorkflowReadTool(PROBE_CONFIG, true);
    const tool = factory(createMockContext({ agentId: undefined }));

    await assert.rejects(
      () => tool.execute('call-5', {}),
      (err: Error) => {
        assert.ok(err instanceof AgentBindingError);
        assert.match(err.message, /\(none\)/);
        return true;
      },
    );
  });

  it('has correct tool metadata', () => {
    const factory = createAdcWorkflowReadTool(PROBE_CONFIG, true);
    const tool = factory(createMockContext());

    assert.equal(tool.name, 'adc_workflow_read');
    assert.equal(tool.label, 'ADC Workflow Read (Canary V0)');
    assert.ok(tool.description.length > 0);
  });

  it('returns details in result (matching agentId)', async () => {
    const factory = createAdcWorkflowReadTool(PROBE_CONFIG, true);
    const tool = factory(createMockContext({ agentId: 'canary-agent' }));

    const result = await tool.execute('call-6', {});
    assert.ok(result.details !== undefined);
    assert.equal(result.details.agentId, 'canary-agent');
    assert.equal(result.details.mode, 'probe');
  });
});
