/**
 * AgentBnB — P2P Agent Capability Sharing Protocol
 *
 * @module agentbnb
 */

// Core types and registry
export { CapabilityCardSchema, type CapabilityCard } from './types/index.js';
export { openDatabase, insertCard, getCard } from './registry/store.js';
export { searchCards } from './registry/matcher.js';
export { openCreditDb, getBalance } from './credit/ledger.js';
export { createGatewayServer } from './gateway/server.js';

// v3.0 — SkillExecutor
export {
  SkillExecutor,
  createSkillExecutor,
  type ExecutionResult,
  type ExecutorMode,
} from './skills/executor.js';
export {
  parseSkillsFile,
  expandEnvVars,
  SkillConfigSchema,
  SkillsFileSchema,
  ApiSkillConfigSchema,
  PipelineSkillConfigSchema,
  OpenClawSkillConfigSchema,
  CommandSkillConfigSchema,
  ConductorSkillConfigSchema,
  type SkillConfig,
  type ApiSkillConfig,
  type PipelineSkillConfig,
  type OpenClawSkillConfig,
  type CommandSkillConfig,
  type ConductorSkillConfig,
} from './skills/skill-config.js';
export {
  ApiExecutor,
  extractByPath,
  buildAuthHeaders,
  applyInputMapping,
} from './skills/api-executor.js';
export { PipelineExecutor } from './skills/pipeline-executor.js';
export { OpenClawBridge } from './skills/openclaw-bridge.js';
export { CommandExecutor } from './skills/command-executor.js';

// v3.0 — Interpolation utilities
export { interpolate, interpolateObject, resolvePath } from './utils/interpolation.js';

// v3.0 — Conductor
export { decompose, TEMPLATES } from './conductor/task-decomposer.js';
export { matchSubTasks, type MatchOptions } from './conductor/capability-matcher.js';
export { BudgetController, ORCHESTRATION_FEE } from './conductor/budget-controller.js';
export {
  buildConductorCard,
  registerConductorCard,
  CONDUCTOR_OWNER,
} from './conductor/card.js';
export {
  type SubTask,
  type MatchResult,
  type ExecutionBudget,
  type OrchestrationResult,
} from './conductor/types.js';

// v3.0 — Conductor Integration
export {
  orchestrate,
  type OrchestrateOptions,
} from './conductor/pipeline-orchestrator.js';
export {
  ConductorMode,
  type ConductorModeOptions,
} from './conductor/conductor-mode.js';

// v3.0 — Signed Escrow
export {
  generateKeyPair,
  signEscrowReceipt,
  verifyEscrowReceipt,
  saveKeyPair,
  loadKeyPair,
  type KeyPair,
} from './credit/signing.js';
export {
  createSignedEscrowReceipt,
  EscrowReceiptSchema,
  type CreateReceiptOpts,
} from './credit/escrow-receipt.js';
export {
  settleProviderEarning,
  settleRequesterEscrow,
  releaseRequesterEscrow,
} from './credit/settlement.js';
export { type EscrowReceipt } from './types/index.js';

// v4.0 — SDK (Consumer / Provider)
export { AgentBnBConsumer, type ConsumerOptions, type ConsumerRequestOptions } from './sdk/consumer.js';
export { AgentBnBProvider, type ProviderOptions, type StartSharingOptions, type SharingContext } from './sdk/provider.js';

// v4.0 — Agent Identity
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
} from './identity/identity.js';
export {
  GuarantorRecordSchema,
  type GuarantorRecord,
  MAX_AGENTS_PER_GUARANTOR,
  GUARANTOR_CREDIT_POOL,
  registerGuarantor,
  linkAgentToGuarantor,
  getGuarantor,
  getAgentGuarantor,
  initiateGithubAuth,
} from './identity/guarantor.js';

// v3.1 — WebSocket Relay
export {
  RelayMessageSchema,
  type RelayMessage,
  type RegisterMessage,
  type RegisteredMessage,
  type RelayRequestMessage,
  type IncomingRequestMessage,
  type RelayResponseMessage,
  type ResponseMessage,
  type ErrorMessage,
  type RelayState,
} from './relay/types.js';
export { registerWebSocketRelay } from './relay/websocket-relay.js';
export { RelayClient, type RelayClientOptions, type RelayHandlerResult } from './relay/websocket-client.js';
export { executeCapabilityRequest, type ExecuteRequestOptions, type ExecuteResult } from './gateway/execute.js';
export { requestViaRelay, type RelayRequestOptions } from './gateway/client.js';

// Smart Onboarding
export {
  detectCapabilities,
  detectFromDocs,
  capabilitiesToV2Card,
  API_PATTERNS,
  INTERACTIVE_TEMPLATES,
  type DetectedCapability,
  type DetectionResult,
  type DetectOptions,
} from './onboarding/index.js';
