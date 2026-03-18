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
