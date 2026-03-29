/**
 * Minimal template renderer for the Genesis template package.
 *
 * Supports:
 * - `{{variable}}`
 * - `{{#if variable}}...{{else}}...{{/if}}`
 */
export function renderTemplate(
  template: string,
  vars: Record<string, unknown>,
): string {
  const withConditionals = template.replace(
    /{{#if\s+([a-zA-Z0-9_]+)}}([\s\S]*?)(?:{{else}}([\s\S]*?))?{{\/if}}/g,
    (_match, key: string, truthy: string, falsy?: string) => {
      return vars[key] ? truthy : (falsy ?? '');
    },
  );

  return withConditionals.replace(
    /{{\s*([a-zA-Z0-9_]+)\s*}}/g,
    (_match, key: string) => String(vars[key] ?? ''),
  );
}
