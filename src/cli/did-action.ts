import { getConfigDir } from './config.js';
import { loadIdentity } from '../identity/identity.js';

/**
 * CLI action: agentbnb did show
 * Displays the local agent's DID identifiers.
 */
export async function didShow(): Promise<void> {
  const configDir = getConfigDir();
  const identity = loadIdentity(configDir);

  if (!identity) {
    console.error('Error: no identity found. Run `agentbnb init` first.');
    process.exit(1);
  }

  const didAgentBnB = identity.did ?? `did:agentbnb:${identity.agent_id}`;

  console.log('Agent Identity (DID)');
  console.log('────────────────────────────────────────');
  console.log(`  agent_id:      ${identity.agent_id}`);
  console.log(`  did:agentbnb:  ${didAgentBnB}`);
  console.log(`  owner:         ${identity.owner}`);
  console.log(`  public_key:    ${identity.public_key.slice(0, 32)}...`);
  console.log(`  created_at:    ${identity.created_at}`);
  if (identity.guarantor) {
    console.log(`  guarantor:     ${identity.guarantor.github_login}`);
  }
}

/**
 * CLI action: agentbnb did show --json
 * Outputs raw identity JSON for programmatic use.
 */
export async function didShowJson(): Promise<void> {
  const configDir = getConfigDir();
  const identity = loadIdentity(configDir);

  if (!identity) {
    console.error('Error: no identity found. Run `agentbnb init` first.');
    process.exit(1);
  }

  const output = {
    agent_id: identity.agent_id,
    did: identity.did ?? `did:agentbnb:${identity.agent_id}`,
    owner: identity.owner,
    public_key: identity.public_key,
    created_at: identity.created_at,
    guarantor: identity.guarantor ?? null,
  };
  console.log(JSON.stringify(output, null, 2));
}
