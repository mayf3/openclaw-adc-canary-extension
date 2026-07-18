/**
 * OpenClaw ADC Canary Extension — Entry Point
 *
 * Phase 0: Registers the adc_workflow_read probe tool.
 *   - No secret reading
 *   - No network requests
 *   - Returns agent identity confirmation for session path verification
 *
 * Phase 2+: Adds secret reading, Direct Token acquisition, and ADC Mock call.
 */

import type { OpenClawPluginApi } from './plugin-api.js';
import { PROBE_CONFIG } from './config.js';
import { createAdcWorkflowReadTool } from './tool.js';
import { assertNoProxyConfigured } from './proxy-guard.js';

/**
 * Plugin registration — called by the OpenClaw Gateway at startup.
 *
 * @param api  The OpenClaw Plugin API provided by the Gateway runtime.
 */
export default function register(api: OpenClawPluginApi): void {
  api.logger.info('[openclaw-adc-canary] Registering plugin...');

  // Check proxy env vars at startup (M-06)
  try {
    assertNoProxyConfigured();
  } catch (err: any) {
    api.logger.error(`[openclaw-adc-canary] Proxy guard: ${err.message}`);
    throw err;
  }

  // Phase 2: Full mode — read secret, obtain Direct Token, call ADC Mock
  const probeMode = false;

  api.registerTool(
    createAdcWorkflowReadTool(PROBE_CONFIG, probeMode),
  );

  api.logger.info(
    `[openclaw-adc-canary] Tool "adc_workflow_read" registered (mode=${probeMode ? 'probe' : 'full'})`,
  );
}
