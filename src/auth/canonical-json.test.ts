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
  });

  describe('numbers', () => {
    it('serializes integers', () => {
      expect(canonicalize(42)).toBe('42');
      expect(canonicalize(0)).toBe('0');
      expect(canonicalize(-1)).toBe('-1');
    });

    it('converts -0 to 0', () => {
      expect(canonicalize(-0)).toBe('0');
    });

    it('serializes floats', () => {
      expect(canonicalize(3.14)).toBe('3.14');
      expect(canonicalize(0.5)).toBe('0.5');
    });

    it('serializes very large numbers', () => {
      expect(canonicalize(1e20)).toBe('100000000000000000000');
    });

    it('serializes very small numbers', () => {
      expect(canonicalize(1e-7)).toBe('1e-7');
    });

    it('serializes Number.MAX_SAFE_INTEGER', () => {
      expect(canonicalize(Number.MAX_SAFE_INTEGER)).toBe('9007199254740991');
    });

    it('throws on NaN', () => {
      expect(() => canonicalize(NaN)).toThrow('non-finite');
    });

    it('throws on Infinity', () => {
      expect(() => canonicalize(Infinity)).toThrow('non-finite');
    });

    it('throws on -Infinity', () => {
      expect(() => canonicalize(-Infinity)).toThrow('non-finite');
    });
  });

  describe('strings', () => {
    it('serializes simple strings', () => {
      expect(canonicalize('hello')).toBe('"hello"');
    });

    it('serializes empty string', () => {
      expect(canonicalize('')).toBe('""');
    });

    it('escapes control characters', () => {
      expect(canonicalize('\n')).toBe('"\\n"');
      expect(canonicalize('\t')).toBe('"\\t"');
      expect(canonicalize('\r')).toBe('"\\r"');
      expect(canonicalize('\b')).toBe('"\\b"');
      expect(canonicalize('\f')).toBe('"\\f"');
    });

    it('escapes backslash and double quote', () => {
      expect(canonicalize('\\')).toBe('"\\\\"');
      expect(canonicalize('"')).toBe('"\\""');
    });

    it('does NOT escape forward slash', () => {
      expect(canonicalize('a/b')).toBe('"a/b"');
    });

    it('escapes other control characters with \\uXXXX', () => {
      // U+0000 NUL
      expect(canonicalize('\u0000')).toBe('"\\u0000"');
      // U+001F INFORMATION SEPARATOR ONE
      expect(canonicalize('\u001f')).toBe('"\\u001f"');
    });

    it('handles Unicode strings (CJK)', () => {
      expect(canonicalize('你好')).toBe('"你好"');
    });

    it('handles emoji', () => {
      expect(canonicalize('hello 🌍')).toBe('"hello 🌍"');
    });
  });

  describe('arrays', () => {
    it('serializes empty array', () => {
      expect(canonicalize([])).toBe('[]');
    });

    it('preserves element order', () => {
      expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
    });

    it('handles mixed types', () => {
      expect(canonicalize([1, 'two', true, null])).toBe('[1,"two",true,null]');
    });

    it('handles nested arrays', () => {
      expect(canonicalize([[1], [2, 3]])).toBe('[[1],[2,3]]');
    });
  });

  describe('objects', () => {
    it('serializes empty object', () => {
      expect(canonicalize({})).toBe('{}');
    });

    it('sorts keys by Unicode codepoint', () => {
      const obj = { b: 2, a: 1 };
      expect(canonicalize(obj)).toBe('{"a":1,"b":2}');
    });

    it('handles nested objects with mixed key ordering', () => {
      const obj = { z: { b: 2, a: 1 }, a: { d: 4, c: 3 } };
      expect(canonicalize(obj)).toBe('{"a":{"c":3,"d":4},"z":{"a":1,"b":2}}');
    });

    it('omits undefined values', () => {
      const obj = { a: 1, b: undefined, c: 3 };
      expect(canonicalize(obj)).toBe('{"a":1,"c":3}');
    });

    it('handles null values in objects', () => {
      const obj = { a: null };
      expect(canonicalize(obj)).toBe('{"a":null}');
    });

    it('handles arrays inside objects', () => {
      const obj = { items: [1, 2], name: 'test' };
      expect(canonicalize(obj)).toBe('{"items":[1,2],"name":"test"}');
    });

    it('sorts keys with Unicode characters correctly', () => {
      // Unicode codepoint order: numbers < uppercase < lowercase
      const obj = { B: 2, a: 1, A: 3 };
      expect(canonicalize(obj)).toBe('{"A":3,"B":2,"a":1}');
    });
  });

  describe('unsupported types', () => {
    it('throws on BigInt', () => {
      expect(() => canonicalize(BigInt(42))).toThrow('BigInt');
    });

    it('throws on Symbol', () => {
      expect(() => canonicalize(Symbol('test'))).toThrow('Symbol');
    });

    it('throws on function', () => {
      expect(() => canonicalize(() => 0)).toThrow('function');
    });

    it('throws on undefined at top level', () => {
      expect(() => canonicalize(undefined)).toThrow('undefined');
    });
  });

  describe('round-trip stability', () => {
    it('produces stable output after parse round-trip', () => {
      const obj = { z: [3, 1], a: { c: 'hello', b: true } };
      const first = canonicalize(obj);
      const second = canonicalize(JSON.parse(first) as unknown);
      expect(second).toBe(first);
    });

    it('is stable for nested structures', () => {
      const obj = {
        agents: [
          { name: 'alpha', skills: ['web-crawl', 'tts'] },
          { name: 'beta', skills: ['code-review'] },
        ],
        version: '1.0',
      };
      const first = canonicalize(obj);
      const second = canonicalize(JSON.parse(first) as unknown);
      expect(second).toBe(first);
    });

    it('is stable for strings with special characters', () => {
      const obj = { msg: 'line1\nline2\ttab', path: 'a/b/c' };
      const first = canonicalize(obj);
      const second = canonicalize(JSON.parse(first) as unknown);
      expect(second).toBe(first);
    });
  });

  describe('complex structures', () => {
    it('handles a realistic capability card fragment', () => {
      const card = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        owner: 'agent-alpha',
        pricing: { credits_per_call: 5 },
        skills: [
          { id: 'tts', name: 'Text to Speech' },
          { id: 'stt', name: 'Speech to Text' },
        ],
      };
      const result = canonicalize(card);
      // Keys must be sorted at every level
      expect(result).toBe(
        '{"id":"550e8400-e29b-41d4-a716-446655440000",' +
        '"owner":"agent-alpha",' +
        '"pricing":{"credits_per_call":5},' +
        '"skills":[{"id":"tts","name":"Text to Speech"},{"id":"stt","name":"Speech to Text"}]}',
      );
    });

    it('handles deeply nested objects', () => {
      const deep = { a: { b: { c: { d: 'leaf' } } } };
      expect(canonicalize(deep)).toBe('{"a":{"b":{"c":{"d":"leaf"}}}}');
    });
  });
});
