import { describe, it, expect } from 'vitest';
import { canonicalize } from './canonical-json.js';

describe('canonicalize (RFC 8785)', () => {
  describe('primitives', () => {
    it('serializes null', () => {
      expect(canonicalize(null)).toBe('null');
    });

    it('serializes true', () => {
      expect(canonicalize(true)).toBe('true');
    });

    it('serializes false', () => {
      expect(canonicalize(false)).toBe('false');
    });

    it('serializes a string', () => {
      expect(canonicalize('hello')).toBe('"hello"');
    });

    it('serializes an empty string', () => {
      expect(canonicalize('')).toBe('""');
    });
  });

  describe('numbers', () => {
    it('serializes integers', () => {
      expect(canonicalize(42)).toBe('42');
      expect(canonicalize(0)).toBe('0');
      expect(canonicalize(-1)).toBe('-1');
    });

    it('serializes floating point', () => {
      expect(canonicalize(3.14)).toBe('3.14');
      expect(canonicalize(0.5)).toBe('0.5');
    });

    it('normalizes -0 to 0', () => {
      expect(canonicalize(-0)).toBe('0');
    });

    it('throws on NaN', () => {
      expect(() => canonicalize(NaN)).toThrow('non-finite number');
    });

    it('throws on Infinity', () => {
      expect(() => canonicalize(Infinity)).toThrow('non-finite number');
    });

    it('throws on -Infinity', () => {
      expect(() => canonicalize(-Infinity)).toThrow('non-finite number');
    });

    it('handles very large numbers', () => {
      expect(canonicalize(1e20)).toBe('100000000000000000000');
    });

    it('handles very small numbers (scientific notation)', () => {
      // ECMAScript uses scientific notation for very small numbers
      expect(canonicalize(1e-7)).toBe('1e-7');
    });

    it('handles Number.MAX_SAFE_INTEGER', () => {
      expect(canonicalize(Number.MAX_SAFE_INTEGER)).toBe('9007199254740991');
    });
  });

  describe('strings', () => {
    it('escapes double quotes', () => {
      expect(canonicalize('say "hi"')).toBe('"say \\"hi\\""');
    });

    it('escapes backslash', () => {
      expect(canonicalize('a\\b')).toBe('"a\\\\b"');
    });

    it('escapes control characters with short escapes', () => {
      expect(canonicalize('\b')).toBe('"\\b"');
      expect(canonicalize('\f')).toBe('"\\f"');
      expect(canonicalize('\n')).toBe('"\\n"');
      expect(canonicalize('\r')).toBe('"\\r"');
      expect(canonicalize('\t')).toBe('"\\t"');
    });

    it('escapes other control chars as \\uXXXX', () => {
      expect(canonicalize('\u0000')).toBe('"\\u0000"');
      expect(canonicalize('\u001f')).toBe('"\\u001f"');
      expect(canonicalize('\u0001')).toBe('"\\u0001"');
    });

    it('does NOT escape forward slash', () => {
      expect(canonicalize('a/b')).toBe('"a/b"');
    });

    it('handles Unicode strings', () => {
      expect(canonicalize('日本語')).toBe('"日本語"');
      expect(canonicalize('emoji: 🎉')).toBe('"emoji: 🎉"');
    });

    it('handles Unicode with mixed ASCII', () => {
      expect(canonicalize('Hello 世界')).toBe('"Hello 世界"');
    });
  });

  describe('arrays', () => {
    it('serializes empty array', () => {
      expect(canonicalize([])).toBe('[]');
    });

    it('preserves array order', () => {
      expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
    });

    it('handles nested arrays', () => {
      expect(canonicalize([[1], [2, 3]])).toBe('[[1],[2,3]]');
    });

    it('handles mixed types in array', () => {
      expect(canonicalize([1, 'two', true, null])).toBe('[1,"two",true,null]');
    });
  });

  describe('objects', () => {
    it('serializes empty object', () => {
      expect(canonicalize({})).toBe('{}');
    });

    it('sorts keys by Unicode codepoint', () => {
      expect(canonicalize({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    });

    it('sorts keys with different casing correctly', () => {
      // Uppercase letters have lower codepoints than lowercase in ASCII
      const result = canonicalize({ b: 2, A: 1, a: 3 });
      expect(result).toBe('{"A":1,"a":3,"b":2}');
    });

    it('omits undefined values', () => {
      expect(canonicalize({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}');
    });

    it('handles nested objects', () => {
      const result = canonicalize({ z: { b: 2, a: 1 }, a: 'first' });
      expect(result).toBe('{"a":"first","z":{"a":1,"b":2}}');
    });

    it('handles objects with array values', () => {
      const result = canonicalize({ items: [3, 1, 2], name: 'test' });
      expect(result).toBe('{"items":[3,1,2],"name":"test"}');
    });
  });

  describe('deeply nested structures', () => {
    it('handles complex nested data', () => {
      const data = {
        users: [
          { name: 'Bob', age: 30 },
          { name: 'Alice', age: 25 },
        ],
        meta: { version: 1, tags: ['a', 'b'] },
      };
      const result = canonicalize(data);
      expect(result).toBe(
        '{"meta":{"tags":["a","b"],"version":1},"users":[{"age":30,"name":"Bob"},{"age":25,"name":"Alice"}]}',
      );
    });
  });

  describe('error cases', () => {
    it('throws on BigInt', () => {
      expect(() => canonicalize(BigInt(42))).toThrow('Cannot canonicalize value of type bigint');
    });

    it('throws on Symbol', () => {
      expect(() => canonicalize(Symbol('x'))).toThrow('Cannot canonicalize value of type symbol');
    });

    it('throws on undefined at top level', () => {
      expect(() => canonicalize(undefined)).toThrow('Cannot canonicalize value of type undefined');
    });

    it('throws on functions', () => {
      expect(() => canonicalize(() => 0)).toThrow('Cannot canonicalize value of type function');
    });
  });

  describe('RFC 8785 test vectors', () => {
    // From RFC 8785 Section 3.2.3 — Sorting of Object Properties
    it('sorts keys by UTF-16 code units', () => {
      // "\u20ac" (€) has higher codepoint than "\r" (0x0d) and "\n" (0x0a)
      const obj = { '\u20ac': 'Euro Sign', '\r': 'Carriage Return', '\n': 'Newline' };
      const result = canonicalize(obj);
      expect(result).toBe(
        '{"\\n":"Newline","\\r":"Carriage Return","€":"Euro Sign"}',
      );
    });

    // From RFC 8785 Section 3.2.2.3 — Number serialization
    it('handles number edge cases from the spec', () => {
      expect(canonicalize(0)).toBe('0');
      expect(canonicalize(-0)).toBe('0');
      expect(canonicalize(1)).toBe('1');
      expect(canonicalize(-1)).toBe('-1');
      expect(canonicalize(0.000001)).toBe('0.000001');
      expect(canonicalize(1e-7)).toBe('1e-7');
      expect(canonicalize(1e+21)).toBe('1e+21');
    });

    // Determinism check — same input always yields same output
    it('produces identical output for equivalent inputs', () => {
      const a = canonicalize({ c: 3, a: 1, b: 2 });
      const b = canonicalize({ b: 2, c: 3, a: 1 });
      expect(a).toBe(b);
      expect(a).toBe('{"a":1,"b":2,"c":3}');
    });
  });
});
