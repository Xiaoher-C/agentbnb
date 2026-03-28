import type Database from 'better-sqlite3';
import { signEscrowReceipt, verifyEscrowReceipt } from '../credit/signing.js';
import { lookupAgent, updateAgentRecord } from './agent-identity.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const OPERATORS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS operators (
    operator_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    public_key TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`;

/**
 * Operator record — a human who manages a fleet of agents.
 */
export interface OperatorRecord {
  operator_id: string;
  display_name: string;
  public_key: string;
  created_at: string;
}

/**
 * Creates the operators table if it does not exist.
 */
export function ensureOperatorsTable(db: Database.Database): void {
  db.exec(OPERATORS_SCHEMA);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Registers an operator in the operators table.
 * Idempotent — returns existing record if operator_id already exists.
 */
export function registerOperator(
  db: Database.Database,
  operatorId: string,
  displayName: string,
  publicKey: string,
): OperatorRecord {
  const now = new Date().toISOString();

  db.prepare(
    `INSERT OR IGNORE INTO operators (operator_id, display_name, public_key, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(operatorId, displayName, publicKey, now);

  return db.prepare('SELECT * FROM operators WHERE operator_id = ?').get(operatorId) as OperatorRecord;
}

/**
 * Looks up an operator by ID.
 */
export function getOperator(
  db: Database.Database,
  operatorId: string,
): OperatorRecord | null {
  return (db.prepare('SELECT * FROM operators WHERE operator_id = ?').get(operatorId) as OperatorRecord | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Claim flow
// ---------------------------------------------------------------------------

/**
 * Signed claim request — an operator claims ownership of an agent.
 */
export interface ClaimRequest {
  action: 'claim';
  agent_id: string;
  operator_id: string;
  timestamp: string;
  signature: string;
}

/**
 * Claims an agent for an operator. Verifies the operator's signature,
 * then binds the agent to the operator in the agents table.
 *
 * @param db - Database with agents and operators tables.
 * @param claim - The signed claim request.
 * @param operatorPublicKey - Hex-encoded Ed25519 public key of the operator.
 * @returns true if claim succeeded.
 */
export function claimAgent(
  db: Database.Database,
  claim: ClaimRequest,
  operatorPublicKey: string,
): { success: boolean; reason?: string } {
  // Verify signature
  const payload: Record<string, unknown> = {
    action: claim.action,
    agent_id: claim.agent_id,
    operator_id: claim.operator_id,
    timestamp: claim.timestamp,
  };
  const pubKeyBuf = Buffer.from(operatorPublicKey, 'hex');
  if (!verifyEscrowReceipt(payload, claim.signature, pubKeyBuf)) {
    return { success: false, reason: 'Invalid operator signature' };
  }

  // Verify agent exists
  const agent = lookupAgent(db, claim.agent_id);
  if (!agent) {
    return { success: false, reason: 'Agent not found' };
  }

  // Verify agent is unclaimed or already claimed by this operator
  if (agent.operator_id && agent.operator_id !== claim.operator_id) {
    return { success: false, reason: 'Agent already claimed by another operator' };
  }

  // Bind agent to operator
  updateAgentRecord(db, claim.agent_id, { operator_id: claim.operator_id });

  return { success: true };
}

/**
 * Creates a signed claim request.
 *
 * @param agentId - Agent to claim.
 * @param operatorId - Operator claiming the agent.
 * @param privateKey - Operator's Ed25519 private key (DER-encoded).
 * @returns Signed ClaimRequest.
 */
export function createClaimRequest(
  agentId: string,
  operatorId: string,
  privateKey: Buffer,
): ClaimRequest {
  const timestamp = new Date().toISOString();
  const payload: Record<string, unknown> = {
    action: 'claim',
    agent_id: agentId,
    operator_id: operatorId,
    timestamp,
  };

  const signature = signEscrowReceipt(payload, privateKey);

  return {
    action: 'claim',
    agent_id: agentId,
    operator_id: operatorId,
    timestamp,
    signature,
  };
}
