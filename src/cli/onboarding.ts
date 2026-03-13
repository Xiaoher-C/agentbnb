/**
 * Smart Onboarding — Pure detection and card generation functions
 *
 * SECURITY CONSTRAINT (LOCKED):
 * This module uses ONLY `key in process.env` for env var existence checks.
 * Env var VALUES are NEVER read, stored, logged, or transmitted.
 * Index access on process dot env is FORBIDDEN in this file.
 *
 * All functions are pure (except process.env existence check and TCP probes)
 * and independently testable without spawning the CLI.
 */

import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import type { CapabilityCard, IOSchema } from '../types/index.js';

/**
 * Template for generating a draft Capability Card from a detected API key.
 */
interface CardTemplate {
  name: string;
  description: string;
  level: 1 | 2 | 3;
  inputs: IOSchema[];
  outputs: IOSchema[];
  pricing: { credits_per_call: number };
  metadata: { apis_used: string[]; tags: string[] };
}

/**
 * Known API key environment variable names to check during onboarding.
 * Each key maps to an entry in API_TEMPLATES.
 */
export const KNOWN_API_KEYS = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'ELEVENLABS_API_KEY',
  'KLING_API_KEY',
  'STABILITY_API_KEY',
  'REPLICATE_API_TOKEN',
  'GOOGLE_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'COHERE_API_KEY',
  'MISTRAL_API_KEY',
] as const;

/**
 * Card templates mapping env var names to Capability Card fields.
 * Used by buildDraftCard() to generate draft cards for detected APIs.
 */
export const API_TEMPLATES: Record<string, CardTemplate> = {
  OPENAI_API_KEY: {
    name: 'OpenAI Text Generation',
    description: 'Text completion and chat via OpenAI API',
    level: 1,
    inputs: [{ name: 'prompt', type: 'text', required: true }],
    outputs: [{ name: 'completion', type: 'text', required: true }],
    pricing: { credits_per_call: 5 },
    metadata: { apis_used: ['openai'], tags: ['llm', 'text', 'generation'] },
  },
  ANTHROPIC_API_KEY: {
    name: 'Anthropic Claude',
    description: 'Text reasoning and analysis via Anthropic Claude API',
    level: 1,
    inputs: [{ name: 'prompt', type: 'text', required: true }],
    outputs: [{ name: 'response', type: 'text', required: true }],
    pricing: { credits_per_call: 5 },
    metadata: { apis_used: ['anthropic'], tags: ['llm', 'text', 'reasoning'] },
  },
  ELEVENLABS_API_KEY: {
    name: 'ElevenLabs Text-to-Speech',
    description: 'High-quality voice synthesis via ElevenLabs API',
    level: 1,
    inputs: [{ name: 'text', type: 'text', required: true }],
    outputs: [{ name: 'audio', type: 'audio', required: true }],
    pricing: { credits_per_call: 10 },
    metadata: { apis_used: ['elevenlabs'], tags: ['tts', 'audio', 'voice'] },
  },
  KLING_API_KEY: {
    name: 'Kling Video Generation',
    description: 'AI video generation via Kling API',
    level: 1,
    inputs: [{ name: 'prompt', type: 'text', required: true }],
    outputs: [{ name: 'video', type: 'video', required: true }],
    pricing: { credits_per_call: 50 },
    metadata: { apis_used: ['kling'], tags: ['video', 'generation', 'ai'] },
  },
  STABILITY_API_KEY: {
    name: 'Stability AI Image Generation',
    description: 'Image generation via Stability AI (Stable Diffusion)',
    level: 1,
    inputs: [{ name: 'prompt', type: 'text', required: true }],
    outputs: [{ name: 'image', type: 'image', required: true }],
    pricing: { credits_per_call: 8 },
    metadata: { apis_used: ['stability'], tags: ['image', 'generation', 'diffusion'] },
  },
  REPLICATE_API_TOKEN: {
    name: 'Replicate Model Runner',
    description: 'Run open-source models via Replicate API',
    level: 1,
    inputs: [{ name: 'input', type: 'json', required: true }],
    outputs: [{ name: 'output', type: 'json', required: true }],
    pricing: { credits_per_call: 10 },
    metadata: { apis_used: ['replicate'], tags: ['ml', 'inference'] },
  },
  GOOGLE_API_KEY: {
    name: 'Google AI (Gemini)',
    description: 'Multimodal AI via Google Gemini API',
    level: 1,
    inputs: [{ name: 'prompt', type: 'text', required: true }],
    outputs: [{ name: 'response', type: 'text', required: true }],
    pricing: { credits_per_call: 5 },
    metadata: { apis_used: ['google'], tags: ['llm', 'multimodal', 'text'] },
  },
  AZURE_OPENAI_API_KEY: {
    name: 'Azure OpenAI Service',
    description: 'OpenAI models hosted on Azure cloud',
    level: 1,
    inputs: [{ name: 'prompt', type: 'text', required: true }],
    outputs: [{ name: 'completion', type: 'text', required: true }],
    pricing: { credits_per_call: 5 },
    metadata: { apis_used: ['azure-openai'], tags: ['llm', 'text', 'azure'] },
  },
  COHERE_API_KEY: {
    name: 'Cohere Language AI',
    description: 'Text generation and embeddings via Cohere API',
    level: 1,
    inputs: [{ name: 'text', type: 'text', required: true }],
    outputs: [{ name: 'response', type: 'text', required: true }],
    pricing: { credits_per_call: 3 },
    metadata: { apis_used: ['cohere'], tags: ['llm', 'embeddings', 'text'] },
  },
  MISTRAL_API_KEY: {
    name: 'Mistral AI',
    description: 'Text generation via Mistral AI API',
    level: 1,
    inputs: [{ name: 'prompt', type: 'text', required: true }],
    outputs: [{ name: 'response', type: 'text', required: true }],
    pricing: { credits_per_call: 4 },
    metadata: { apis_used: ['mistral'], tags: ['llm', 'text', 'generation'] },
  },
};

/**
 * Detect which known API keys exist in the current environment.
 *
 * SECURITY: Uses `key in process.env` (boolean existence check ONLY).
 * Never reads, stores, or logs env var values.
 *
 * @param knownKeys - List of env var names to check
 * @returns Array of env var names that exist in process.env
 */
export function detectApiKeys(knownKeys: readonly string[]): string[] {
  return knownKeys.filter((key) => key in process.env);
}

/**
 * Check if a TCP port has a listening service.
 *
 * @param port - Port number to probe
 * @param host - Host to connect to (default: 127.0.0.1)
 * @param timeoutMs - Connection timeout in milliseconds (default: 300)
 * @returns true if the port has a listener, false otherwise
 */
export async function isPortOpen(
  port: number,
  host = '127.0.0.1',
  timeoutMs = 300,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.on('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

/**
 * Detect which ports from a list have active listeners.
 * Probes all ports in parallel using Promise.all with 300ms timeout.
 *
 * @param ports - List of port numbers to probe
 * @returns Array of port numbers that have active listeners
 */
export async function detectOpenPorts(
  ports: readonly number[],
): Promise<number[]> {
  const results = await Promise.all(
    ports.map(async (port) => ({ port, open: await isPortOpen(port) })),
  );
  return results.filter((r) => r.open).map((r) => r.port);
}

/**
 * Build a draft Capability Card from a detected API key name.
 *
 * @param apiKey - The env var name (e.g., 'OPENAI_API_KEY')
 * @param owner - The owner name for the card
 * @returns A valid CapabilityCard or null if the key is unknown
 */
export function buildDraftCard(
  apiKey: string,
  owner: string,
): CapabilityCard | null {
  const template = API_TEMPLATES[apiKey];
  if (!template) return null;

  const now = new Date().toISOString();
  return {
    spec_version: '1.0',
    id: randomUUID(),
    owner,
    name: template.name,
    description: template.description,
    level: template.level,
    inputs: template.inputs,
    outputs: template.outputs,
    pricing: template.pricing,
    availability: { online: true },
    metadata: {
      apis_used: template.metadata.apis_used,
      tags: template.metadata.tags,
    },
    created_at: now,
    updated_at: now,
  };
}
