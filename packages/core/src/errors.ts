import type { SecretFinding } from './types';

/** Base error for all Substrata failures. */
export class SubstrataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubstrataError';
  }
}

/** Configuration is missing, malformed, or has an unsupported schema_version. */
export class ConfigError extends SubstrataError {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** A footprint/memory file could not be parsed or is missing required metadata. */
export class ParseError extends SubstrataError {
  readonly filePath?: string;

  constructor(message: string, filePath?: string) {
    super(filePath ? `${message} (${filePath})` : message);
    this.name = 'ParseError';
    this.filePath = filePath;
  }
}

/** One or more secrets were detected and the write was refused. */
export class SecretDetectedError extends SubstrataError {
  readonly findings: SecretFinding[];

  constructor(findings: SecretFinding[]) {
    const detail = findings.map((f) => `${f.name} at line ${f.line}`).join(', ');
    super(`Refusing to write: ${findings.length} potential secret(s) detected: ${detail}`);
    this.name = 'SecretDetectedError';
    this.findings = findings;
  }
}

/** A requested resource (e.g. a footprint id) could not be found. */
export class NotFoundError extends SubstrataError {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}
