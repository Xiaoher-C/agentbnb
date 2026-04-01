/**
 * RFC 8785 Canonical JSON serializer.
 *
 * Produces deterministic JSON output suitable for cryptographic signing.
 * Object keys are sorted by Unicode codepoint, numbers are normalized
 * per the ES specification, and only required JSON escapes are emitted.
 *
 * @see https://www.rfc-editor.org/rfc/rfc8785
 */

import { AgentBnBError } from '../types/index.js';

/**
 * Escape a string value per RFC 8785 / JSON spec.
 *
 * Only control characters (U+0000-U+001F) and the two structural
 * characters backslash and double-quote are escaped.  Forward slash
 * is NOT escaped (RFC 8785 Section 3.2.2.2).
 */
function escapeString(s: string): string {
  let result = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    if (ch === 0x08) {
      result += '\\b';
    } else if (ch === 0x09) {
      result += '\\t';
    } else if (ch === 0x0a) {
      result += '\\n';
    } else if (ch === 0x0c) {
      result += '\\f';
    } else if (ch === 0x0d) {
      result += '\\r';
    } else if (ch === 0x22) {
      result += '\\"';
    } else if (ch === 0x5c) {
      result += '\\\\';
    } else if (ch < 0x20) {
      // Other control characters: use \uXXXX
      result += '\\u' + ch.toString(16).padStart(4, '0');
    } else {
      result += s[i];
    }
  }
  result += '"';
  return result;
}

/**
 * Serialize a number per RFC 8785 / ES Number-to-String rules.
 *
 * -0 becomes "0".  NaN, Infinity, and -Infinity are rejected.
 * All other numbers use `JSON.stringify` which already follows the
 * ES specification for Number::toString (no trailing zeros, shortest
 * representation, etc.).
 */
function serializeNumber(n: number): string {
  if (!Number.isFinite(n)) {
    throw new AgentBnBError(
      `Cannot canonicalize non-finite number: ${String(n)}`,
      'CANONICAL_JSON_ERROR',
    );
  }
  // Convert -0 to 0
  if (Object.is(n, -0)) {
    return '0';
  }
  return JSON.stringify(n);
}

/**
 * Serialize a value to RFC 8785 canonical JSON.
 *
 * Deterministic serialization for cryptographic signing.  Produces
 * the same byte sequence regardless of object insertion order.
 *
 * @param value - The value to serialize.
 * @returns Canonical JSON string.
 * @throws {AgentBnBError} with code 'CANONICAL_JSON_ERROR' for
 *         unsupported types (BigInt, Symbol, Function) or non-finite
 *         numbers (NaN, Infinity, -Infinity).
 */
export function canonicalize(value: unknown): string {
  return serializeValue(value);
}

/**
 * Internal recursive serializer.
 */
function serializeValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';

    case 'number':
      return serializeNumber(value);

    case 'string':
      return escapeString(value);

    case 'bigint':
      throw new AgentBnBError(
        'Cannot canonicalize BigInt values',
        'CANONICAL_JSON_ERROR',
      );

    case 'symbol':
      throw new AgentBnBError(
        'Cannot canonicalize Symbol values',
        'CANONICAL_JSON_ERROR',
      );

    case 'function':
      throw new AgentBnBError(
        'Cannot canonicalize function values',
        'CANONICAL_JSON_ERROR',
      );

    case 'undefined':
      // Top-level undefined is not valid JSON
      throw new AgentBnBError(
        'Cannot canonicalize undefined at top level',
        'CANONICAL_JSON_ERROR',
      );

    case 'object': {
      if (Array.isArray(value)) {
        return serializeArray(value);
      }
      return serializeObject(value as Record<string, unknown>);
    }

    default:
      throw new AgentBnBError(
        `Cannot canonicalize unknown type: ${typeof value}`,
        'CANONICAL_JSON_ERROR',
      );
  }
}

/**
 * Serialize an array, preserving element order.
 */
function serializeArray(arr: unknown[]): string {
  const elements = arr.map((item) => serializeValue(item));
  return '[' + elements.join(',') + ']';
}

/**
 * Serialize an object with keys sorted by Unicode codepoint.
 * Entries whose value is `undefined` are silently omitted per RFC 8785.
 */
function serializeObject(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  const entries: string[] = [];
  for (const key of keys) {
    const val = obj[key];
    if (val === undefined) {
      continue;
    }
    entries.push(escapeString(key) + ':' + serializeValue(val));
  }
  return '{' + entries.join(',') + '}';
}
