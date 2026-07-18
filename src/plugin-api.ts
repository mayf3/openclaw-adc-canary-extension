/**
 * Minimal TypeScript types matching the OpenClaw Plugin SDK 2026.3.13.
 *
 * These types mirror the subset of the SDK used by this extension.
 * At runtime, the actual OpenClaw runtime provides the real SDK.
 *
 * Source: /usr/local/lib/node_modules/openclaw/dist/plugin-sdk/plugins/types.d.ts
 */

// ─── Tool Schema (TypeBox-based) ──────────────────────────────────────────

/**
 * TypeBox TSchema interface — used by the OpenClaw tool system.
 * We use `@sinclair/typebox` for runtime schema validation matching
 * the pattern used by all bundled OpenClaw extensions.
 */
export interface TSchema {
  // Placeholder — @sinclair/typebox provides the real implementation.
  [key: string]: unknown;
}

// ─── Tool Context ─────────────────────────────────────────────────────────

/**
 * Context passed to plugin tool factories.
 *
 * The agentId is derived from the Gateway session key and is NOT
 * controllable by the model or any tool parameter.
 */
export interface OpenClawPluginToolContext {
  config?: Record<string, unknown>;
  workspaceDir?: string;
  agentDir?: string;
  /** Trusted agent identifier from the Gateway session. */
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  messageChannel?: string;
  agentAccountId?: string;
  requesterSenderId?: string;
  senderIsOwner?: boolean;
  sandboxed?: boolean;
}

// ─── Tool Result ──────────────────────────────────────────────────────────

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  data: string;
  mimeType?: string;
}

export interface AgentToolResult<TDetails = unknown> {
  content: (TextContent | ImageContent)[];
  details: TDetails;
}

// ─── Tool Definition ──────────────────────────────────────────────────────

export interface AgentTool<TParameters extends TSchema = TSchema, TDetails = unknown> {
  name: string;
  label: string;
  description: string;
  parameters: TParameters;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: unknown,
  ) => Promise<AgentToolResult<TDetails>>;
}

export type AnyAgentTool = AgentTool<TSchema, unknown>;

export type OpenClawPluginToolFactory = (
  ctx: OpenClawPluginToolContext,
) => AnyAgentTool | AnyAgentTool[] | null | undefined;

export interface OpenClawPluginToolOptions {
  name?: string;
  names?: string[];
  optional?: boolean;
}

// ─── Plugin API ───────────────────────────────────────────────────────────

export interface PluginLogger {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

export interface OpenClawPluginApi {
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;
  logger: PluginLogger;

  registerTool: (
    tool: AnyAgentTool | OpenClawPluginToolFactory,
    opts?: OpenClawPluginToolOptions,
  ) => void;
}

// ─── Plugin Definition ────────────────────────────────────────────────────

export interface OpenClawPlugin {
  id: string;
  name: string;
  description?: string;
  configSchema?: Record<string, unknown>;
  register: (api: OpenClawPluginApi) => void;
}

export default OpenClawPlugin;
