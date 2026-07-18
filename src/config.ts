/**
 * Canary deployment configuration — non-sensitive binding information.
 *
 * All values are set at deployment time from a legacy-user-unwritable
 * configuration source. Tool parameters, workspace files, and env vars
 * must NOT override these values.
 *
 * In Phase 1A, these will be loaded from /private/etc/oc-canary/config.json
 * (or equivalent controlled path). For Phase 0 / probe testing, defaults
 * are injected via the plugin register() call.
 */

export interface CanaryConfig {
  /** Expected OpenClaw agent ID for this canary instance. */
  expectedAgentId: string;
  /** MachineClient ID for token requests. */
  machineClientId: string;
  /** auth-service origin (scheme + host + port). */
  authServiceOrigin: string;
  /** ADC Mock origin (scheme + host + port). */
  adcMockOrigin: string;
  /** Absolute path to the machine client secret file. */
  secretFilePath: string;
}

/**
 * Default config for Phase 0 / Phase 1B probe testing.
 * No secrets are loaded at this stage.
 */
export const PROBE_CONFIG: CanaryConfig = {
  expectedAgentId: 'canary-agent',
  machineClientId: 'cm_placeholder',
  authServiceOrigin: 'http://127.0.0.1:4001',
  adcMockOrigin: 'http://127.0.0.1:9099',
  secretFilePath: '/private/etc/oc-canary/secrets/adc-machine-client-secret',
};
