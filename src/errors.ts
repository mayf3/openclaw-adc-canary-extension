/**
 * Custom error types for the ADC Canary Extension.
 *
 * All errors follow fail-closed semantics: unexpected inputs, states,
 * or responses result in a thrown error rather than a best-effort result.
 */

/**
 * Error indicating the tool was invoked by an unexpected agent.
 * The agentId from the trusted context does not match the expected
 * canary binding.
 */
export class AgentBindingError extends Error {
  constructor(expectedAgentId: string, actualAgentId: string) {
    super(
      `Agent binding mismatch: expected "${expectedAgentId}", got "${actualAgentId}"`,
    );
    this.name = 'AgentBindingError';
  }
}

/**
 * Error indicating a tool input validation failure (unknown field, type mismatch).
 * Used when the tool schema rejects the call.
 */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}

/**
 * Error indicating the tool was called with parameters it should not accept
 * (e.g., overriding security-critical fields).
 */
export class SecurityConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityConfigError';
  }
}
