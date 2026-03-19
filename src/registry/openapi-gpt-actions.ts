/**
 * Converts a standard OpenAPI 3.0 spec into GPT Actions-compatible format.
 *
 * GPT Actions differences from standard OpenAPI:
 * 1. Only GET and POST methods supported (strip DELETE, PATCH, PUT)
 * 2. `servers` must have exactly one entry with absolute URL
 * 3. Remove security schemes GPT can't handle (Ed25519 custom headers)
 * 4. Strip internal/owner-only endpoints (paths starting with /me, /draft)
 * 5. Add `operationId` to every operation if missing
 * 6. Remove /docs, /ws, and /api/credits paths (internal or require Ed25519)
 *
 * @param openapiSpec - The full OpenAPI 3.0 spec object from server.swagger()
 * @param serverUrl - Absolute base URL for the GPT Actions server entry
 * @returns A GPT Actions-compatible OpenAPI 3.0 spec
 */
export function convertToGptActions(
  openapiSpec: Record<string, unknown>,
  serverUrl: string,
): Record<string, unknown> {
  // Deep-clone to avoid mutating the original
  const spec = JSON.parse(JSON.stringify(openapiSpec)) as Record<string, unknown>;

  // Set servers to single absolute URL
  spec.servers = [{ url: serverUrl }];

  // Filter paths
  const paths = spec.paths as Record<string, Record<string, unknown>> | undefined;
  if (paths) {
    const filteredPaths: Record<string, Record<string, unknown>> = {};

    for (const [path, methods] of Object.entries(paths)) {
      // Skip owner-only, internal, credit (Ed25519), docs, and WebSocket paths
      if (
        path.startsWith('/me') ||
        path.startsWith('/draft') ||
        path.startsWith('/docs') ||
        path.startsWith('/ws') ||
        path.startsWith('/api/credits')
      ) {
        continue;
      }

      // Filter to only GET and POST methods
      const filteredMethods: Record<string, unknown> = {};
      for (const [method, operation] of Object.entries(methods)) {
        if (method === 'get' || method === 'post') {
          const op = operation as Record<string, unknown>;

          // Add operationId if missing
          if (!op.operationId) {
            op.operationId = deriveOperationId(method, path);
          }

          // Remove per-operation security (GPT uses its own auth)
          delete op.security;

          filteredMethods[method] = op;
        }
      }

      if (Object.keys(filteredMethods).length > 0) {
        filteredPaths[path] = filteredMethods;
      }
    }

    spec.paths = filteredPaths;
  }

  // Remove security schemes from components
  const components = spec.components as Record<string, unknown> | undefined;
  if (components) {
    delete components.securitySchemes;
  }

  // Filter tags to only those still referenced
  const usedTags = new Set<string>();
  if (spec.paths) {
    for (const methods of Object.values(spec.paths as Record<string, Record<string, unknown>>)) {
      for (const op of Object.values(methods)) {
        const operation = op as Record<string, unknown>;
        if (Array.isArray(operation.tags)) {
          for (const tag of operation.tags) {
            usedTags.add(tag as string);
          }
        }
      }
    }
  }

  if (Array.isArray(spec.tags)) {
    spec.tags = (spec.tags as Array<{ name: string }>).filter((t) => usedTags.has(t.name));
  }

  return spec;
}

/**
 * Derives an operationId from HTTP method and path.
 *
 * Examples:
 *   GET  /cards       -> getCards
 *   POST /cards       -> postCards
 *   GET  /api/pricing -> getApiPricing
 *   GET  /cards/{id}  -> getCardsById
 *
 * @param method - HTTP method (lowercase)
 * @param path - URL path
 * @returns A camelCase operationId
 */
function deriveOperationId(method: string, path: string): string {
  const segments = path
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => {
      // Convert path parameters {id} -> ById
      if (s.startsWith('{') || s.startsWith(':')) {
        const paramName = s.replace(/[{}:]/g, '');
        return 'By' + paramName.charAt(0).toUpperCase() + paramName.slice(1);
      }
      // Convert kebab-case to camelCase and capitalize first letter
      return s
        .split('-')
        .map((part, i) => (i === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part.charAt(0).toUpperCase() + part.slice(1)))
        .join('');
    });

  return method + segments.join('');
}
