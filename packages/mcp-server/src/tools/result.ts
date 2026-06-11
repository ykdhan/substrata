// Shared helpers for building MCP tool results. See plan §9.

/**
 * Build a successful tool result. Returns the payload as JSON text content (the
 * universally-supported channel) plus `structuredContent` for clients on the
 * newer MCP spec that consume structured output directly.
 */
export function jsonResult(payload: Record<string, unknown>): {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: Record<string, unknown>;
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

/**
 * Build a structured tool error. The message is human-readable; `details`
 * (e.g. secret pattern names + line numbers) is exposed as structuredContent so
 * callers can react programmatically. Never include secret values.
 */
export function errorResult(
  message: string,
  details?: Record<string, unknown>,
): {
  isError: true;
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
} {
  const result: {
    isError: true;
    content: Array<{ type: 'text'; text: string }>;
    structuredContent?: Record<string, unknown>;
  } = {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
  if (details) result.structuredContent = details;
  return result;
}
