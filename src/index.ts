/**
 * AgentBnB — P2P Agent Capability Sharing Protocol
 *
 * @module agentbnb
 */

export { CapabilityCardSchema, type CapabilityCard } from './types/index.js';
export { openDatabase, insertCard, getCard } from './registry/store.js';
export { searchCards } from './registry/matcher.js';
export { openCreditDb, getBalance } from './credit/ledger.js';
export { createGatewayServer } from './gateway/server.js';
