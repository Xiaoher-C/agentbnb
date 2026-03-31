/**
 * RFC 8785 Canonical JSON Serialization (JCS).
 *
 * Produces a deterministic JSON string from any JSON-compatible value.
 * Unlike `JSON.stringify` with a replacer, this follows the full RFC 8785 spec:
 * - Object keys sorted by Unicode codepoint (not locale)
 * - Number serialization matches ECMAScript `Number.toString()`
 * - No `-0` (normalized to `0`)
 * - No `Infinity`, `NaN`, `BigInt`, `Symbol`, or `undefined` values
 * - Strings use minimal escaping (`\uXXXX` only when required by JSON spec)
 *
 * @see https://www.rfc-editor.org/rfc/rfc8785
 * @module
 */

import { AgentBnBError } from '../types/index.js';

/**
 * Serializes a value to canonical JSON per RFC 8785.
 *
 * @param value - Any JSON-compatible value (object, array, string, number, boolean, null).
 * @returns Canonical JSON string.
 * @throws {AgentBnBError} with code 'CANONICAL_JSON_ERROR' for non-serializable values.
 */
export function canonicalize(value: unknown): string {
  return serializeValue(value);
}

/**
 * Recursively serializes a value following RFC 8785 rules.
 */
function serializeValue(value: unknown): string {
  // null
  if (value === null) {
    return 'null';
  }

  // boolean
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  // number
  if (typeof value === 'number') {
    return serializeNumber(value);
  }

  // string
  if (typeof value === 'string') {
    return serializeString(value);
  }

  // array
  if (Array.isArray(value)) {
    const items = value.map((item) => serializeValue(item));
    return '[' + items.join(',') + ']';
  }

  // plain object
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      return serializeObject(value as Record<string, unknown>);
    }
    throw new AgentBnBError(
      `Cannot canonicalize non-plain object: ${Object.getPrototypeOf(value)?.constructor?.name ?? 'unknown'}`,
      'CANONICAL_JSON_ERROR',
    );
  }

  // bigint, symbol, undefined, function
  throw new AgentBnBError(
    `Cannot canonicalize value of type ${typeof value}`,
    'CANONICAL_JSON_ERROR',
  );
}

/**
 * Serializes a number per RFC 8785 / ECMAScript Number.toString().
 * Rejects NaN, Infinity, -Infinity. Normalizes -0 to 0.
 */
function serializeNumber(n: number): string {
  if (!Number.isFinite(n)) {
    throw new AgentBnBError(
      `Cannot canonicalize non-finite number: ${String(n)}`,
      'CANONICAL_JSON_ERROR',
    );
  }

  // Normalize -0 to 0
  if (Object.is(n, -0)) {
    return '0';
  }

  // ECMAScript Number.toString() matches RFC 8785 requirements for
  // IEEE 754 double-precision — no leading zeros, minimal representation.
  return String(n);
}

/**
 * Serializes a string with minimal JSON escaping per RFC 8785.
 * Only escapes characters required by the JSON spec (RFC 8259):
 * - U+0000..U+001F control characters → \uXXXX (or short escapes for \b \f \n \r \t)
 * - U+0022 (") → \"
 * - U+005C (\) → \\
 * Does NOT escape forward slash (/).
 */
function serializeString(s: string): string {
  let result = '"';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);

    if (code === 0x22) {
      // "
      result += '\\"';
    } else if (code === 0x5c) {
      // backslash
      result += '\\\\';
    } else if (code === 0x08) {
      // backspace
      result += '\\b';
    } else if (code === 0x0c) {
      // form feed
      result += '\\f';
    } else if (code === 0x0a) {
      // newline
      result += '\\n';
    } else if (code === 0x0d) {
      // carriage return
      result += '\\r';
    } else if (code === 0x09) {
      // tab
      result += '\\t';
    } else if (code < 0x20) {
      // Other control characters → \uXXXX
      result += '\\u' + code.toString(16).padStart(4, '0');
    } else {
      result += s[i];
    }
  }
  result += '"';
  return result;
}

/**
 * Serializes an object with keys sorted by Unicode codepoint (UTF-16 code units).
 * Properties with `undefined` values are omitted (matching JSON.stringify behavior).
 */
function serializeObject(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort((a, b) => {
    // RFC 8785: sort by Unicode codepoint — in JS this is the default
    // string comparison (UTF-16 code unit order), which matches < operator.
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });

  const members: string[] = [];
  for (const key of keys) {
    const val = obj[key];
    // Omit undefined values (same as JSON.stringify)
    if (val === undefined) {
      continue;
    }
    members.push(serializeString(key) + ':' + serializeValue(val));
  }

  return '{' + members.join(',') + '}';
}
