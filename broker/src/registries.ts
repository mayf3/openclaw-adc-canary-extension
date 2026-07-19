/**
 * Registries — Trusted configuration registries for agent clients,
 * target services, and capabilities.
 *
 * All registries are populated from the plugin's config block at startup.
 * They are read-only at runtime; the model cannot create or modify entries.
 */

import type { SecretRef } from './plugin-api.js';

// ─── Config Shapes (mirrors openclaw.plugin.json configSchema) ────────────

export interface AgentClientEntry {
  clientId: string;
  credentialRef: SecretRef;
}

export interface TargetEntry {
  targetId: string;
  audience: string;
  allowedOrigin: string;
}

export interface CapabilityEntry {
  capabilityId: string;
  targetId: string;
  requiredScopes: string[];
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
}

export interface BrokerPluginConfig {
  /** Global kill switch. When false, no tools are registered. */
  globalEnabled: boolean;
  /** Allowlist of agent IDs that may invoke broker tools. */
  enabledAgentIds: string[];
  /** Per-agent OAuth2 client credential mappings. */
  agentClients: Record<string, AgentClientEntry>;
  /** Registered target services. */
  targets: TargetEntry[];
  /** Registered capabilities. */
  capabilities: CapabilityEntry[];
  /** Auth-service token endpoint origin, e.g. http://localhost:4982. */
  authServiceOrigin?: string;
}

// ─── Errors ───────────────────────────────────────────────────────────────

export class AgentNotAllowedError extends Error {
  constructor(agentId: string) {
    super(`Agent "${agentId}" is not in the broker allowlist`);
    this.name = 'AgentNotAllowedError';
  }
}

export class AgentClientNotFoundError extends Error {
  constructor(agentId: string) {
    super(`No client credential mapping for agent "${agentId}"`);
    this.name = 'AgentClientNotFoundError';
  }
}

export class UnknownTargetError extends Error {
  constructor(targetId: string) {
    super(`Unknown target: "${targetId}"`);
    this.name = 'UnknownTargetError';
  }
}

export class UnknownCapabilityError extends Error {
  constructor(capabilityId: string) {
    super(`Unknown capability: "${capabilityId}"`);
    this.name = 'UnknownCapabilityError';
  }
}

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(`Broker config validation failed: ${message}`);
    this.name = 'ConfigValidationError';
  }
}

// ─── Registry ─────────────────────────────────────────────────────────────

export class Registries {
  private _allowedAgentSet: Set<string>;
  private _clientMap: Map<string, AgentClientEntry>;
  private _targetMap: Map<string, TargetEntry>;
  private _capabilityMap: Map<string, CapabilityEntry>;
  private _authServiceOrigin: string;

  constructor(config: BrokerPluginConfig) {
    this.validateConfig(config);

    this._allowedAgentSet = new Set(config.enabledAgentIds);
    this._clientMap = new Map(Object.entries(config.agentClients));
    this._targetMap = new Map(config.targets.map(t => [t.targetId, t]));
    this._capabilityMap = new Map(config.capabilities.map(c => [c.capabilityId, c]));
    this._authServiceOrigin = (config.authServiceOrigin ?? 'http://localhost:4982').replace(/\/+$/, '');
  }

  // ── Validation ────────────────────────────────────────────────────────

  private validateConfig(config: BrokerPluginConfig): void {
    const errors: string[] = [];

    if (typeof config.globalEnabled !== 'boolean') {
      errors.push('globalEnabled must be a boolean');
    }
    if (!Array.isArray(config.enabledAgentIds)) {
      errors.push('enabledAgentIds must be an array');
    }
    if (typeof config.agentClients !== 'object' || config.agentClients === null) {
      errors.push('agentClients must be a non-null object');
    }
    if (!Array.isArray(config.targets)) {
      errors.push('targets must be an array');
    }
    if (!Array.isArray(config.capabilities)) {
      errors.push('capabilities must be an array');
    }

    if (errors.length > 0) {
      throw new ConfigValidationError(errors.join('; '));
    }

    // Validate target/capability references
    const targetIds = new Set(config.targets.map(t => t.targetId));
    for (const cap of config.capabilities) {
      if (!targetIds.has(cap.targetId)) {
        errors.push(`capability "${cap.capabilityId}" references unknown target "${cap.targetId}"`);
      }
    }

    if (errors.length > 0) {
      throw new ConfigValidationError(errors.join('; '));
    }
  }

  // ── Agent Allowlist Gate ──────────────────────────────────────────────

  /**
   * Check whether an agent is in the allowlist.
   * Throw AgentNotAllowedError if not.
   */
  assertAgentAllowed(agentId: string): void {
    if (!agentId || !this._allowedAgentSet.has(agentId)) {
      throw new AgentNotAllowedError(agentId);
    }
  }

  // ── Client Lookup ─────────────────────────────────────────────────────

  /** Look up an agent's OAuth2 client configuration. */
  getAgentClient(agentId: string): AgentClientEntry {
    const client = this._clientMap.get(agentId);
    if (!client) {
      throw new AgentClientNotFoundError(agentId);
    }
    return client;
  }

  /** Check if agent has a configured client mapping. */
  hasAgentClient(agentId: string): boolean {
    return this._clientMap.has(agentId);
  }

  // ── Target Lookup ─────────────────────────────────────────────────────

  /** Look up a target service configuration. */
  getTarget(targetId: string): TargetEntry {
    const target = this._targetMap.get(targetId);
    if (!target) {
      throw new UnknownTargetError(targetId);
    }
    return target;
  }

  // ── Capability Lookup ─────────────────────────────────────────────────

  /** Look up a capability configuration. */
  getCapability(capabilityId: string): CapabilityEntry {
    const cap = this._capabilityMap.get(capabilityId);
    if (!cap) {
      throw new UnknownCapabilityError(capabilityId);
    }
    return cap;
  }

  // ── Auth Service ──────────────────────────────────────────────────────

  /** Get the configured auth-service origin. */
  get authServiceOrigin(): string {
    return this._authServiceOrigin;
  }

  /** Get the set of enabled agent IDs. */
  get enabledAgentIds(): string[] {
    return Array.from(this._allowedAgentSet);
  }
}
