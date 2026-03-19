/**
 * OpenAI Function Calling Schema Generator for AgentBnB.
 *
 * Fetches the GPT Actions OpenAPI spec from a running AgentBnB Registry
 * and transforms it into the OpenAI function calling format.
 *
 * Usage:
 *   npx tsx adapters/openai/generate.ts
 *   npx tsx adapters/openai/generate.ts --registry-url https://registry.agentbnb.dev
 *
 * Copyright 2026 Cheng Wen Chen, MIT License
 */

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface OpenAPISpec {
  paths: Record<string, Record<string, OpenAPIOperation>>;
}

interface OpenAPIOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: OpenAPIParam[];
  requestBody?: {
    content?: {
      'application/json'?: {
        schema?: JSONSchema;
      };
    };
  };
}

interface OpenAPIParam {
  name: string;
  in: string;
  description?: string;
  required?: boolean;
  schema?: { type?: string; default?: unknown };
}

interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  description?: string;
  default?: unknown;
}

interface FunctionDef {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

function parseArgs(): { registryUrl: string } {
  const args = process.argv.slice(2);
  let registryUrl = 'http://localhost:3000';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--registry-url' && args[i + 1]) {
      registryUrl = args[i + 1];
      i++;
    }
  }

  return { registryUrl };
}

function operationToFunction(
  method: string,
  _path: string,
  op: OpenAPIOperation,
): FunctionDef {
  const name = op.operationId ?? `${method}_${_path.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const description = [op.summary, op.description].filter(Boolean).join('. ');

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  // Extract query/path parameters
  if (op.parameters) {
    for (const param of op.parameters) {
      properties[param.name] = {
        type: param.schema?.type ?? 'string',
        description: param.description,
        ...(param.schema?.default !== undefined ? { default: param.schema.default } : {}),
      };
      if (param.required) {
        required.push(param.name);
      }
    }
  }

  // Extract request body schema
  const bodySchema = op.requestBody?.content?.['application/json']?.schema;
  if (bodySchema?.properties) {
    for (const [key, prop] of Object.entries(bodySchema.properties)) {
      properties[key] = prop;
    }
    if (bodySchema.required) {
      required.push(...bodySchema.required);
    }
  }

  return {
    name,
    description: description || name,
    parameters: { type: 'object', properties, required },
  };
}

async function main(): Promise<void> {
  const { registryUrl } = parseArgs();
  const url = `${registryUrl}/api/openapi/gpt-actions?server_url=${encodeURIComponent(registryUrl)}`;

  console.log(`Fetching OpenAPI spec from: ${url}`);
  const resp = await fetch(url);

  if (!resp.ok) {
    console.error(`Failed to fetch OpenAPI spec: ${resp.status} ${resp.statusText}`);
    process.exit(1);
  }

  const spec: OpenAPISpec = await resp.json() as OpenAPISpec;
  const functions: FunctionDef[] = [];

  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
        functions.push(operationToFunction(method.toUpperCase(), path, operation));
      }
    }
  }

  const outPath = join(__dirname, 'functions.json');
  writeFileSync(outPath, JSON.stringify(functions, null, 2) + '\n');
  console.log(`Generated ${functions.length} function definitions -> ${outPath}`);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
