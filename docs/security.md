# Security and Privacy

Substrata files are committed to the repo, so security defaults must be conservative. A leaked secret enters permanent Git history.

## What Not to Store

**Never store:**

- API keys, access tokens, refresh tokens
- Private keys, certificates, keystore files
- Passwords, passphrases
- Cookies, session tokens
- OAuth credentials (client_secret, etc.)
- Production database dumps
- Raw customer data or personally identifiable information
- Slack/email credentials or message content
- SSH keys
- JSON Web Tokens (JWTs) with sensitive claims

**Guiding principle:** If it would be a security incident to leak it in Git history, do not include it in a Substrata footprint.

## Key-Based Redaction

Recursive redaction for common keys. Values are replaced with `[REDACTED]`:

```ts
const DEFAULT_REDACTION_KEYS = [
  'token',
  'apiKey',
  'api_key',
  'authorization',
  'password',
  'secret',
  'cookie',
  'set-cookie',
  'privateKey',
  'accessToken',
  'refreshToken',
];
```

**How it works:**

- Before adding a footprint, `substrata add` recursively walks the input object
- For any key matching the redaction list (case-insensitive), the value is replaced with `[REDACTED]`
- This catches secrets embedded in command output, example configs, etc.

Example:

```javascript
// Input
{
  note: "Tested with apiKey: sk-12345678",
  config: { secret: "mysecret123" }
}

// After redaction
{
  note: "Tested with apiKey: [REDACTED]",
  config: { secret: "[REDACTED]" }
}
```

## Content Pattern Scanning

Key-based redaction misses secrets embedded in prose or command output. A content scanner runs over the footprint body and detects:

```ts
export const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'aws_access_key_id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'github_pat', re: /\bghp_[A-Za-z0-9]{36}\b/ },
  { name: 'github_fine_grained', re: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/ },
  { name: 'gitlab_pat', re: /\bglpat-[A-Za-z0-9_-]{20}\b/ },
  { name: 'slack_token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'google_api_key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'openai_key', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: 'anthropic_key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { name: 'private_key_block', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: 'bearer_header', re: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/ },
  { name: 'url_basic_auth', re: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s:@]+@/i },
];
```

When a pattern matches, the secret is not disclosed to the user. Instead, the error reports:

```
- github_pat at body line 14
- jwt at body line 27
```

This way, the user knows what to fix without the secret value being exposed.

## Behavior on Detection

When running `substrata add` (CLI or MCP):

1. Key-based redaction is applied automatically
2. Content pattern scan runs over the result
3. If matches remain after redaction and `security.block_on_secret` is true:
   - **Write is refused**
   - Error lists pattern names + line numbers (never values)
   - User must redact and retry, or use `--allow-secret` (not recommended)

Example error:

```
✖ Refusing to write footprint: 2 potential secrets detected
  - github_pat at body line 14
  - jwt at body line 27
  Redact these or pass --allow-secret to override (NOT recommended — footprints are committed).
```

**Important:** The `--allow-secret` flag is provided for exceptional cases (e.g., sanitized examples, test data). Using it is **not recommended** because footprints are committed to the repo.

## Pre-Commit Hook

For defense in depth, `substrata hook install` adds an optional pre-commit hook that runs the same secret scan over staged `.substrata/**` files:

```bash
substrata hook install
```

This is a second line of defense: it catches secrets in hand-edited footprint files before they are committed.

The hook:

- Runs on staged files only
- Reports findings (pattern names + line numbers, never values)
- **Does not block commit** by default; treat warnings seriously
- Can be skipped with `git commit --no-verify` (use sparingly)

Install via:

```bash
substrata hook install
```

The hook is optional. The CLI secret scan is always active.

## Best-Effort, Not a Guarantee

**Important:** The CLI secret scan is **best-effort**, not a guarantee of security.

The pattern-based approach catches common cases but cannot detect:

- Obfuscated secrets (rot13, base64, etc.)
- Custom or unusual token formats
- Secrets embedded in long narrative text
- Encoded API responses

**Recommendations:**

1. **Always review** footprints manually before committing, especially if they contain code output or command logs
2. **Use the pre-commit hook** (`substrata hook install`) as a second line of defense
3. **Never disable redaction** (`--no-redact`) in production configs
4. **Rotate credentials** if a secret ever appears in Git history
5. **Educate your team** on what not to include
6. **Use environment variables** for secrets, not hardcoded values

## Configuration

In `.substrata/config.yml`:

```yaml
security:
  redact: true # enable key-based redaction (default: true)
  scan_content: true # enable pattern scanning (default: true)
  entropy_scan: false # high-entropy heuristic (default: false, limited false positives)
  entropy_min_length: 32 # minimum length for entropy check
  block_on_secret: true # refuse to write if secret remains (default: true)
  redaction_keys:
    - token
    - apiKey
    - api_key
    - authorization
    - password
    - secret
    - cookie
    - privateKey
    - accessToken
    - refreshToken
```

- **`redact: false`** disables all redaction (not recommended; shown as warning in init)
- **`scan_content: false`** skips pattern scanning (not recommended)
- **`entropy_scan: true`** enables high-entropy heuristic (off by default to avoid false positives)
- **`block_on_secret: false`** allows writes even if secrets remain (dangerous; use only in non-prod)

All security defaults are conservative: redaction enabled, pattern scanning enabled, write-blocking enabled.

## Workflow

### Safe Footprint Workflow

```bash
# 1. Create a footprint with sensitive context
substrata add \
  --title "Set up OAuth2 for learner login" \
  --purpose "Replace email/password with OAuth" \
  --notes "Used production OAuth client_id ABC123..."

# 2. If secrets are detected, get clear error:
# ✖ Refusing to write footprint: 1 potential secret detected
#   - oauth_client_id at body line 7
#   Redact this or pass --allow-secret to override.

# 3. Redact and retry:
substrata add \
  --title "Set up OAuth2 for learner login" \
  --purpose "Replace email/password with OAuth" \
  --notes "Used production OAuth client_id [REDACTED]..."

# 4. Success!
```

### If a Secret Ever Leaks

If a secret appears in committed history:

1. Immediately **rotate the credential** (new API key, new token, etc.)
2. Force-push to remove the secret from history (coordinate with team)
3. Update any keys/tokens that may have been exposed
4. Document in a footprint: "Rotated XYZ credential after accidental commit"

## Entropy Scanning

The MVP does not enable entropy scanning by default because it produces false positives:

```yaml
entropy_scan: false
```

If enabled, it flags long standalone tokens with high character entropy (many unique chars in a row). Use carefully in non-prod environments; disable in production to avoid alert fatigue.

## Questions?

- For security issues, email the maintainers privately
- For general guidance on secrets management, see OWASP or your organization's policy
- Remember: the pattern scan catches most common cases, but **manual review is always recommended**
