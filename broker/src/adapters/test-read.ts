/**
 * Test Read Adapter — Extensibility proof.
 *
 * Registers a `test_read` capability for a second target (test-service).
 * This demonstrates that adding a new target + capability requires:
 * - Zero changes to BrokerCore
 * - Zero changes to Registries
 * - Only adding a config entry and this adapter file
 *
 * The adapter:
 * - Declares an empty parameter schema.
 * - Delegates to BrokerCore.authorizedFetch().
 * - Normalizes test-service response.
 */

import { Type, type Static } from '@sinclair/typebox';
import type { OpenClawPluginToolContext } from '../plugin-api.js';
import { BrokerCore } from '../broker-core.js';

// ─── Capability ID ────────────────────────────────────────────────────────

export const TEST_READ_CAPABILITY = 'test_read';

// ─── Parameter Schema ─────────────────────────────────────────────────────

export const TestReadSchema = Type.Object(
  {},
  {
    additionalProperties: false,
    description: 'Test-only: read from a second test service to prove extensibility. No parameters needed.',
  },
);

export type TestReadParams = Static<typeof TestReadSchema>;

// ─── Tool Factory ─────────────────────────────────────────────────────────

export function createTestReadTool(
  broker: BrokerCore,
) {
  return (_ctx: OpenClawPluginToolContext) => ({
    name: 'test_read',
    label: 'Test Service Read (Extensibility Proof)',
    description: '测试用：读取第二测试服务的数据。用于验证 Broker Core 无需修改即可扩展新 Target。不接受自定义参数。',
    parameters: TestReadSchema as any,
    execute: async (
      _toolCallId: string,
      _params: TestReadParams,
    ) => {
      const result = await broker.authorizedFetch(
        _ctx,
        TEST_READ_CAPABILITY,
        _params ?? {},
      );

      const responseText = typeof result === 'string'
        ? result
        : JSON.stringify(result);

      return {
        content: [{ type: 'text' as const, text: responseText }],
        details: { capability: TEST_READ_CAPABILITY },
      };
    },
  });
}
