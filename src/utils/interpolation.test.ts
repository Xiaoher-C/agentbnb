import { describe, it, expect } from 'vitest';
import { interpolate, interpolateObject, resolvePath } from './interpolation.js';

describe('resolvePath', () => {
  it('resolves a simple key', () => {
    expect(resolvePath({ name: 'Alice' }, 'name')).toBe('Alice');
  });

  it('resolves a nested dot-path', () => {
    expect(resolvePath({ a: { b: { c: 42 } } }, 'a.b.c')).toBe(42);
  });

  it('resolves array index notation', () => {
    const obj = { steps: [{ result: 'audio.mp3' }, { result: 'video.mp4' }] };
    expect(resolvePath(obj, 'steps[0].result')).toBe('audio.mp3');
    expect(resolvePath(obj, 'steps[1].result')).toBe('video.mp4');
  });

  it('returns undefined for missing path', () => {
    expect(resolvePath({ a: 1 }, 'b.c')).toBeUndefined();
  });

  it('returns undefined for non-object traversal', () => {
    expect(resolvePath({ a: 'string' }, 'a.b')).toBeUndefined();
  });
});

describe('interpolate', () => {
  it('returns unchanged string when no ${} expressions', () => {
    expect(interpolate('hello world', {})).toBe('hello world');
  });

  it('replaces ${params.name} with context value', () => {
    const ctx = { params: { name: 'Alice' } };
    expect(interpolate('Hello ${params.name}', ctx)).toBe('Hello Alice');
  });

  it('resolves nested path ${prev.result.text}', () => {
    const ctx = { prev: { result: { text: 'transcript here' } } };
    expect(interpolate('${prev.result.text}', ctx)).toBe('transcript here');
  });

  it('resolves array index ${steps[0].result.audio}', () => {
    const ctx = { steps: [{ result: { audio: 'file.mp3' } }] };
    expect(interpolate('${steps[0].result.audio}', ctx)).toBe('file.mp3');
  });

  it('replaces missing path with empty string', () => {
    expect(interpolate('${missing.path}', {})).toBe('');
  });

  it('resolves multiple ${} expressions in one string', () => {
    const ctx = { a: 'foo', b: 'bar' };
    expect(interpolate('${a} and ${b}', ctx)).toBe('foo and bar');
  });

  it('JSON.stringifies object values', () => {
    const ctx = { data: { x: 1 } };
    const result = interpolate('${data}', ctx);
    expect(result).toBe('{"x":1}');
  });

  it('passes through non-string template types (number → string)', () => {
    const ctx = { count: 5 };
    expect(interpolate('count: ${count}', ctx)).toBe('count: 5');
  });
});

describe('interpolateObject', () => {
  it('interpolates string values in a flat object', () => {
    const ctx = { name: 'Bob' };
    const obj = { greeting: 'Hello ${name}', other: 'no vars' };
    expect(interpolateObject(obj, ctx)).toEqual({
      greeting: 'Hello Bob',
      other: 'no vars',
    });
  });

  it('deep-walks nested objects', () => {
    const ctx = { value: 'deep' };
    const obj = { outer: { inner: '${value}' } };
    expect(interpolateObject(obj, ctx)).toEqual({ outer: { inner: 'deep' } });
  });

  it('interpolates string values in arrays', () => {
    const ctx = { item: 'thing' };
    const obj = { list: ['${item}', 'literal'] };
    expect(interpolateObject(obj, ctx)).toEqual({ list: ['thing', 'literal'] });
  });

  it('preserves non-string leaf values unchanged', () => {
    const ctx = {};
    const obj = { num: 42, flag: true, nul: null };
    expect(interpolateObject(obj, ctx)).toEqual({ num: 42, flag: true, nul: null });
  });
});
