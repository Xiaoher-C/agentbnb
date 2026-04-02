/**
 * AgentBnB MnemoPay Adapter
 *
 * Adds memory-payment feedback loop to AgentBnB agents.
 * When payments settle, memories get reinforced.
 * When payments refund, reputation is docked.
 * The agent learns which providers deliver over time.
 *
 * @module adapters/mnemopay
 */

export {
  MnemoPayAdapter,
  type MnemoPayAdapterOptions,
  type MemoryAwareRequestOptions,
} from './adapter.js';
