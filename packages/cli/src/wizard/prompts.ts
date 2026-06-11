import {
  confirm as clackConfirm,
  isCancel,
  multiselect as clackMultiselect,
  text as clackText,
  type Option,
} from '@clack/prompts';

/**
 * Thin wrapper over @clack/prompts with a non-TTY guard.
 *
 * When stdout/stdin is not a TTY, or `assumeYes` is set, prompts must NOT render;
 * every prompt resolves to its supplied default. This keeps the wizard usable in
 * pipes/CI (which behave as `--yes`) and in tests without a fake terminal.
 */

let assumeYesFlag = false;

/** Force non-interactive mode (used by `--yes` and non-TTY detection). */
export function setAssumeYes(value: boolean): void {
  assumeYesFlag = value;
}

/** True when prompts should be skipped (non-TTY or `--yes`). */
export function isNonInteractive(): boolean {
  return assumeYesFlag || !process.stdout.isTTY || !process.stdin.isTTY;
}

/** Raised when a user cancels an interactive prompt (Ctrl-C). */
export class PromptCancelledError extends Error {
  constructor() {
    super('Prompt cancelled');
    this.name = 'PromptCancelledError';
  }
}

function guardCancel<T>(value: T | symbol): T {
  if (isCancel(value)) throw new PromptCancelledError();
  return value as T;
}

/** Free-text prompt. Returns `defaultValue` in non-interactive mode. */
export async function promptText(options: {
  message: string;
  defaultValue: string;
  placeholder?: string;
}): Promise<string> {
  if (isNonInteractive()) return options.defaultValue;
  const result = await clackText({
    message: options.message,
    placeholder: options.placeholder ?? options.defaultValue,
    defaultValue: options.defaultValue,
    initialValue: options.defaultValue,
  });
  const value = guardCancel(result);
  return value.length > 0 ? value : options.defaultValue;
}

/** Yes/no prompt. Returns `defaultValue` in non-interactive mode. */
export async function promptConfirm(options: {
  message: string;
  defaultValue: boolean;
}): Promise<boolean> {
  if (isNonInteractive()) return options.defaultValue;
  const result = await clackConfirm({
    message: options.message,
    initialValue: options.defaultValue,
  });
  return guardCancel(result);
}

/** Multi-select prompt. Returns `defaultValues` in non-interactive mode. */
export async function promptMultiselect<Value>(options: {
  message: string;
  choices: Array<{ value: Value; label: string; hint?: string }>;
  defaultValues: Value[];
}): Promise<Value[]> {
  if (isNonInteractive()) return options.defaultValues;
  if (options.choices.length === 0) return [];
  // `Option<Value>` is a conditional type; an unresolved generic can't be
  // simplified by TS, so build the array as the concrete shape and assert.
  const choices = options.choices.map((c) => ({
    value: c.value,
    label: c.label,
    ...(c.hint !== undefined ? { hint: c.hint } : {}),
  })) as Option<Value>[];

  const result = await clackMultiselect<Value>({
    message: options.message,
    options: choices,
    initialValues: options.defaultValues,
    required: false,
  });
  return guardCancel(result);
}
