import type { AdapterConfig } from './config.js';

/**
 * Runtime context for the adapter, established at startup.
 * Contains resolved identity and configuration.
 */
export interface AdapterContext {
  /** Loaded adapter configuration */
  config: AdapterConfig;
  /** DID of the service account (e.g. did:agentbnb:<agent_id>) */
  serviceAccountDID: string;
  /** Agent ID derived from public key (sha256(pubkey).slice(0,16)) */
  serviceAccountAgentId: string;
  /** Base64-encoded Ed25519 public key */
  serviceAccountPublicKey: string;
}
