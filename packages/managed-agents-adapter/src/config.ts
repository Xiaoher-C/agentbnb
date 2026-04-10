/**
 * Adapter configuration loaded from environment variables.
 */
export interface AdapterConfig {
  /** AgentBnB protocol registry endpoint */
  registryUrl: string;
  /** Managed Agents beta header value (changes across API versions) */
  managedAgentsBetaHeader: string;
  /** HTTP port for the adapter server */
  port: number;
  /** Path to persistent Ed25519 keystore directory */
  keystorePath: string;
  /** Maximum session cost in USD (billing guardrail) */
  maxSessionCost: number;
  /** Service account owner name */
  serviceAccountOwner: string;
}

/**
 * Load adapter configuration from environment variables.
 * Falls back to sensible defaults where appropriate.
 */
export function loadAdapterConfig(): AdapterConfig {
  return {
    registryUrl: process.env['REGISTRY_URL'] ?? 'https://agentbnb.fly.dev',
    managedAgentsBetaHeader: process.env['MANAGED_AGENTS_BETA_HEADER'] ?? 'managed-agents-2026-04-01',
    port: parseInt(process.env['ADAPTER_PORT'] ?? '7702', 10),
    keystorePath: process.env['KEYSTORE_PATH'] ?? '/data',
    maxSessionCost: parseFloat(process.env['MAX_SESSION_COST'] ?? '5.00'),
    serviceAccountOwner: process.env['SERVICE_ACCOUNT_OWNER'] ?? 'adapter-service-account',
  };
}
