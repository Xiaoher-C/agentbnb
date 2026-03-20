import type Database from 'better-sqlite3';
import { holdEscrow, settleEscrow, releaseEscrow } from '../credit/escrow.js';

/**
 * Looks up the credits_per_call price for a capability card.
 *
 * If a skillId is provided and the card has a `skills` array, returns pricing
 * for the matching skill. Falls back to card-level pricing if the skill is not
 * found in the array.
 *
 * @param registryDb - The registry database containing capability_cards.
 * @param cardId - The ID of the capability card to look up.
 * @param skillId - Optional skill ID to get skill-level pricing.
 * @returns credits_per_call as a number, or null if card not found or pricing missing.
 */
export function lookupCardPrice(
  registryDb: Database.Database,
  cardId: string,
  skillId?: string,
): number | null {
  const row = registryDb
    .prepare('SELECT data FROM capability_cards WHERE id = ?')
    .get(cardId) as { data: string } | undefined;

  if (!row) return null;

  let card: Record<string, unknown>;
  try {
    card = JSON.parse(row.data) as Record<string, unknown>;
  } catch {
    return null;
  }

  // If card has a skills array, attempt skill-level pricing
  if (Array.isArray(card.skills) && card.skills.length > 0) {
    const skills = card.skills as Array<Record<string, unknown>>;

    if (skillId) {
      // Match by skill ID — fall through to card-level pricing if not found
      const skill = skills.find((s) => s.id === skillId);
      if (skill) {
        const skillPricing = skill.pricing as Record<string, unknown> | undefined;
        if (skillPricing && typeof skillPricing.credits_per_call === 'number') {
          return skillPricing.credits_per_call;
        }
      }
      // Skill ID provided but not found — fall through to card-level pricing
    } else {
      // No skillId — return the minimum skill price as a floor so v2.0
      // multi-skill cards always trigger a credit hold even when the caller
      // does not specify which skill is being invoked.
      let minPrice: number | null = null;
      for (const s of skills) {
        const sp = s.pricing as Record<string, unknown> | undefined;
        if (sp && typeof sp.credits_per_call === 'number' && sp.credits_per_call > 0) {
          if (minPrice === null || sp.credits_per_call < minPrice) {
            minPrice = sp.credits_per_call;
          }
        }
      }
      if (minPrice !== null) return minPrice;
    }
  }

  // Card-level pricing (v1.0 cards or v2.0 fallback)
  const pricing = card.pricing as Record<string, unknown> | undefined;
  if (!pricing || typeof pricing.credits_per_call !== 'number') {
    return null;
  }

  return pricing.credits_per_call;
}

/**
 * Holds credits in escrow for a relay request.
 *
 * Thin wrapper around holdEscrow that surfaces the same error code
 * (INSUFFICIENT_CREDITS) when the requester has insufficient balance.
 *
 * @param creditDb - The credit database instance.
 * @param owner - The requester's agent identifier.
 * @param amount - Number of credits to hold.
 * @param cardId - The capability card ID being requested.
 * @returns The new escrow ID.
 * @throws {AgentBnBError} with code 'INSUFFICIENT_CREDITS' if balance < amount.
 */
export function holdForRelay(
  creditDb: Database.Database,
  owner: string,
  amount: number,
  cardId: string,
): string {
  return holdEscrow(creditDb, owner, amount, cardId);
}

/**
 * Settles a relay escrow, transferring credits to the provider.
 * Called on successful relay response from the provider.
 *
 * @param creditDb - The credit database instance.
 * @param escrowId - The escrow ID created by holdForRelay.
 * @param recipientOwner - The provider agent who receives the credits.
 */
export function settleForRelay(
  creditDb: Database.Database,
  escrowId: string,
  recipientOwner: string,
): void {
  settleEscrow(creditDb, escrowId, recipientOwner);
}

/**
 * Calculates the Conductor orchestration fee (ADR-019).
 *
 * Fee = 10% of total sub-task cost, rounded up to the nearest integer.
 * Clamped to a minimum of 1 credit and a maximum of 20 credits.
 * Returns 0 for zero or negative cost (no fee on zero-cost orchestration).
 *
 * @param totalSubTaskCost - The total credits charged across all sub-tasks.
 * @returns The conductor fee in credits.
 */
export function calculateConductorFee(totalSubTaskCost: number): number {
  if (totalSubTaskCost <= 0) return 0;
  const fee = Math.ceil(totalSubTaskCost * 0.1);
  return Math.max(1, Math.min(20, fee));
}

/**
 * Releases a relay escrow, refunding credits back to the requester.
 * Called on relay timeout, provider error response, or provider disconnect.
 *
 * If escrowId is undefined (hold was never created or failed before escrow),
 * this function returns without throwing.
 *
 * @param creditDb - The credit database instance.
 * @param escrowId - The escrow ID to release, or undefined for no-op.
 */
export function releaseForRelay(
  creditDb: Database.Database,
  escrowId: string | undefined,
): void {
  if (escrowId === undefined) return;
  releaseEscrow(creditDb, escrowId);
}
