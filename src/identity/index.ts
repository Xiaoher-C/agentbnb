/**
 * Agent Identity — unified identity layer for AgentBnB agents.
 *
 * @module identity
 */

// Core identity
export {
  AgentIdentitySchema,
  AgentCertificateSchema,
  type AgentIdentity,
  type AgentCertificate,
  deriveAgentId,
  createIdentity,
  loadIdentity,
  saveIdentity,
  ensureIdentity,
  issueAgentCertificate,
  verifyAgentCertificate,
} from './identity.js';

// Agent records (V8 agents table)
export {
  type AgentRecord,
  ensureAgentsTable,
  createAgentRecord,
  lookupAgent,
  lookupAgentByOwner,
  listAgentsByOperator,
  updateAgentRecord,
  resolveIdentifier,
} from './agent-identity.js';

// Delegation tokens (V8 Phase 3)
export {
  type DelegationToken,
  type DelegationPermission,
  createDelegationToken,
  verifyDelegationToken,
  hasPermission,
} from './delegation.js';

// Operators (V8 Phase 4)
export {
  type OperatorRecord,
  type ClaimRequest,
  ensureOperatorsTable,
  registerOperator,
  getOperator,
  claimAgent,
  createClaimRequest,
} from './operators.js';

// DID Core (W3C Decentralized Identifiers)
export {
  type DIDDocument,
  toDIDKey,
  toDIDAgentBnB,
  parseDID,
  buildDIDDocument,
} from './did.js';

// Human Guarantor
export {
  GuarantorRecordSchema,
  type GuarantorRecord,
  MAX_AGENTS_PER_GUARANTOR,
  GUARANTOR_CREDIT_POOL,
  ensureGuarantorTables,
  registerGuarantor,
  linkAgentToGuarantor,
  getGuarantor,
  getAgentGuarantor,
  initiateGithubAuth,
} from './guarantor.js';
