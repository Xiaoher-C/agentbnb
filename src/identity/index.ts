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
  canonicalizeAgentId,
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
  resolveCanonicalIdentity,
  canonicalizeAgentId,
  sameAgentIdentity,
  type CanonicalIdentity,
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

// DID Rotation
export {
  type RotationRecord,
  ROTATION_GRACE_DAYS,
  createRotationRecord,
  verifyRotationRecord,
  isWithinGracePeriod,
  rotateKeys,
} from './did-rotation.js';

// DID Revocation
export {
  type RevocationRecord,
  DIDRevocationRegistry,
  createRevocationRecord,
  verifyRevocationRecord,
} from './did-revocation.js';

// EVM Bridge (Ed25519 ↔ secp256k1 cross-chain identity)
export {
  type EVMBridgeLink,
  createBridgeLink,
  verifyBridgeLink,
  derivePseudoEVMAddress,
} from './evm-bridge.js';

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
