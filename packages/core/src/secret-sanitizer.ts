import { createHash } from "node:crypto";

export const REDACTED_SECRET = "[REDACTED_SECRET]";

const SENSITIVE_KEY =
  /(?:token|password|secret|apikey|api_key|authorization|cookie|privatekey|private_key|clientsecret|credential)/i;

const SECRET_PATTERNS: Array<RegExp> = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /((?:https?|postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?):\/\/)([^\s/:@]+):([^\s/@]+)@/gi,
  /\b(?:aws_access_key_id|aws_secret_access_key|client_secret|api[_-]?key)\s*[:=]\s*["']?[^\s"'&;,]+/gi,
  /(?:[?&]|\b)(?:token|password|secret|api[_-]?key|authorization)\s*=\s*[^&#\s]+/gi,
];
const HIGH_ENTROPY_PATTERN = /\b[A-Za-z0-9_+\/=.-]{32,}\b/g;

export interface Sanitized<T> {
  value: T;
  redacted: boolean;
}

export function sanitizeText(input: string): Sanitized<string> {
  let value = input;
  let redacted = false;
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    const next = value.replace(pattern, (...args: unknown[]) => {
      redacted = true;
      // Preserve the scheme for URL credentials so diagnostics remain useful.
      const match = args[0];
      if (typeof match === "string" && typeof args[1] === "string") {
        return `${args[1]}${REDACTED_SECRET}@`;
      }
      return REDACTED_SECRET;
    });
    value = next;
  }
  value = value.replace(HIGH_ENTROPY_PATTERN, (candidate) => {
    if (!looksLikeOpaqueSecret(candidate)) return candidate;
    redacted = true;
    return REDACTED_SECRET;
  });
  return { value, redacted };
}

function looksLikeOpaqueSecret(candidate: string): boolean {
  if (candidate.length < 32 || /^[a-f0-9]{32,}$/i.test(candidate)) return false;
  const readableSegments = candidate.split(/[\/._=+\-]+/).filter(Boolean);
  if (
    readableSegments.length >= 3 &&
    Math.max(...readableSegments.map((segment) => segment.length)) < 24
  )
    return false;
  const classes = [
    /[a-z]/.test(candidate),
    /[A-Z]/.test(candidate),
    /\d/.test(candidate),
    /[_+\/=.-]/.test(candidate),
  ].filter(Boolean).length;
  if (classes < 3) return false;
  const frequencies = new Map<string, number>();
  for (const character of candidate)
    frequencies.set(character, (frequencies.get(character) ?? 0) + 1);
  const entropy = [...frequencies.values()].reduce((total, count) => {
    const probability = count / candidate.length;
    return total - probability * Math.log2(probability);
  }, 0);
  return entropy >= 4;
}

export function sanitizeValue<T>(input: T): Sanitized<T> {
  const result = sanitizeUnknown(input, false);
  return result as Sanitized<T>;
}

function sanitizeUnknown(
  input: unknown,
  sensitiveKey: boolean,
): Sanitized<unknown> {
  if (sensitiveKey) return { value: REDACTED_SECRET, redacted: true };
  if (typeof input === "string") return sanitizeText(input);
  if (Array.isArray(input)) {
    let redacted = false;
    const value = input.map((entry) => {
      const result = sanitizeUnknown(entry, false);
      redacted ||= result.redacted;
      return result.value;
    });
    return { value, redacted };
  }
  if (input && typeof input === "object") {
    let redacted = false;
    const value: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(input)) {
      const result = sanitizeUnknown(entry, SENSITIVE_KEY.test(key));
      redacted ||= result.redacted;
      value[key] = result.value;
    }
    return { value, redacted };
  }
  return { value: input, redacted: false };
}

export function sanitizedHash(input: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(sanitizeValue(input).value))
    .digest("hex");
}
