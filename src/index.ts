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
