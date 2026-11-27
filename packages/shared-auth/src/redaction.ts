const SENSITIVE_KEY_PATTERN =
  /(password|passwd|secret|token|authorization|cookie|api[_-]?key|key[_-]?hash|private[_-]?key|client[_-]?secret|mfa[_-]?secret|recovery[_-]?code|service[_-]?role)/i;

const MAX_DEPTH = 8;

/** Recursively redacts credentials, tokens, and secrets before writing logs or audit entries. */
export function redactSecrets(input: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH || input === null || input === undefined) {
    return input;
  }
  if (typeof input === "string") {
    if (/^Bearer\s+\S+/i.test(input)) return "Bearer [REDACTED]";
    if (/^ddc_(live|test)_[A-Za-z0-9_-]+$/.test(input)) return "[REDACTED_KEY]";
    return input;
  }
  if (Array.isArray(input)) {
    return input.map((item) => redactSecrets(item, depth + 1));
  }
  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      input as Record<string, unknown>,
    )) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = "[REDACTED]";
      } else {
        out[key] = redactSecrets(value, depth + 1);
      }
    }
    return out;
  }
  return input;
}
