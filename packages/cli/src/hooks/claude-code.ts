/**
 * Adapter between Claude Code's hook protocol and Substrata. Claude Code invokes
 * a hook command, writes a JSON event payload to its stdin, and reads the hook's
 * stdout. For SessionStart / UserPromptSubmit a `hookSpecificOutput.additionalContext`
 * string is appended to the model's context.
 *
 * Hooks MUST fail open: a slow or throwing hook degrades the user's session, so
 * everything here is defensive and the caller wraps handlers in `runHook`.
 */

export type HookEventName =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'Stop'
  | 'SubagentStop'
  | string;

export type HookPayload = {
  hook_event_name?: HookEventName;
  /** Present on UserPromptSubmit. */
  prompt?: string;
  /** Present on SessionStart: "startup" | "resume" | "clear" | "compact". */
  source?: string;
  /** Present on Stop/SubagentStop: true while a prior stop hook is still running. */
  stop_hook_active?: boolean;
  cwd?: string;
  session_id?: string;
  [key: string]: unknown;
};

/** Read all of stdin as UTF-8. Resolves '' for a TTY or if nothing arrives soon. */
export function readStdin(timeoutMs = 2000): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (stdin.isTTY) {
      resolve('');
      return;
    }
    let data = '';
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(data);
    };
    const timer = setTimeout(finish, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    stdin.setEncoding('utf8');
    stdin.on('data', (chunk) => {
      data += chunk;
    });
    stdin.on('end', finish);
    stdin.on('error', finish);
  });
}

/** Parse a hook payload from stdin; returns an empty payload on any failure. */
export async function readHookPayload(): Promise<HookPayload> {
  const raw = await readStdin();
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as HookPayload) : {};
  } catch {
    return {};
  }
}

/**
 * Emit context to be injected for SessionStart / UserPromptSubmit. Empty/blank
 * text emits nothing (no noise). Returns the JSON string for testability.
 */
export function emitContext(eventName: HookEventName, text: string | undefined): string | null {
  if (!text || !text.trim()) return null;
  const payload = {
    hookSpecificOutput: { hookEventName: eventName, additionalContext: text },
  };
  const json = JSON.stringify(payload);
  process.stdout.write(`${json}\n`);
  return json;
}

/**
 * Emit a Stop/SubagentStop "block" decision: Claude Code feeds `reason` back to
 * the model and lets it continue, which is how the session-end footprint nudge
 * is enforced. Loop-safety is the caller's job (skip when stop_hook_active).
 * Returns the JSON string for testability.
 */
export function emitStopDecision(reason: string): string {
  const json = JSON.stringify({ decision: 'block', reason });
  process.stdout.write(`${json}\n`);
  return json;
}

/**
 * Run a hook handler with fail-open semantics: any thrown error is swallowed and
 * the process exits 0 so Claude Code is never blocked by a Substrata hook.
 */
export async function runHook(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch {
    // Intentionally silent: a hook must never break the user's session.
  }
  process.exitCode = 0;
}
