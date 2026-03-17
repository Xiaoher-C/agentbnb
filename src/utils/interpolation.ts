/**
 * Resolves a dot-path expression (optionally with array index notation) against an object.
 *
 * Examples:
 * - "name"           → obj.name
 * - "a.b.c"          → obj.a.b.c
 * - "steps[0].result" → obj.steps[0].result
 *
 * @param obj  - The root object to traverse.
 * @param path - A dot-separated path string, supporting `[N]` array index notation.
 * @returns The resolved value, or `undefined` if any segment is missing.
 */
export function resolvePath(obj: unknown, path: string): unknown {
  // Split path into segments, handling both 'key' and '[N]' notation
  const segments = path
    .replace(/\[(\d+)\]/g, '.$1') // convert [0] → .0
    .split('.')
    .filter((s) => s.length > 0);

  let current: unknown = obj;
  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Interpolates `${expression}` placeholders in a template string against a context object.
 *
 * - Resolves dot-path and array-index expressions against `context`.
 * - Object values are JSON.stringify'd.
 * - Missing paths resolve to empty string.
 * - Non-string (number, boolean, etc.) values are converted via String().
 *
 * @param template - A string containing zero or more `${...}` expressions.
 * @param context  - The object to resolve expressions against.
 * @returns The interpolated string.
 */
export function interpolate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\$\{([^}]+)\}/g, (_match, expression: string) => {
    const resolved = resolvePath(context, expression.trim());
    if (resolved === undefined || resolved === null) {
      return '';
    }
    if (typeof resolved === 'object') {
      return JSON.stringify(resolved);
    }
    return String(resolved);
  });
}

/**
 * Deep-walks an object and interpolates all string leaf values using the given context.
 *
 * Handles nested objects and arrays recursively. Non-string leaf values are preserved
 * unchanged.
 *
 * @param obj     - The object whose string values should be interpolated.
 * @param context - The interpolation context (same as `interpolate`).
 * @returns A new object with all string leaves interpolated.
 */
export function interpolateObject(
  obj: Record<string, unknown>,
  context: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = interpolateValue(value, context);
  }
  return result;
}

/**
 * Recursively interpolates a value: strings are interpolated, arrays and objects
 * are walked, all other types are returned as-is.
 *
 * @param value   - Any value.
 * @param context - Interpolation context.
 * @returns The interpolated value.
 */
function interpolateValue(value: unknown, context: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    return interpolate(value, context);
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateValue(item, context));
  }
  if (value !== null && typeof value === 'object') {
    return interpolateObject(value as Record<string, unknown>, context);
  }
  return value;
}
