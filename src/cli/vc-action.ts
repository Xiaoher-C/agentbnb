import { getConfigDir, loadConfig } from './config.js';
import { loadIdentity } from '../identity/identity.js';

/**
 * CLI action: agentbnb vc show
 * Displays available Verifiable Credentials for the local agent.
 */
export async function vcShow(opts: { json?: boolean }): Promise<void> {
  const configDir = getConfigDir();
  const identity = loadIdentity(configDir);

  if (!identity) {
    console.error('Error: no identity found. Run `agentbnb init` first.');
    process.exit(1);
  }

  const config = loadConfig();
  if (!config?.registry) {
    console.error('Error: no registry configured. Run `agentbnb config set registry <url>`');
    process.exit(1);
  }

  const registryUrl = config.registry.replace(/\/$/, '');
  const agentId = identity.agent_id;

  let res: Response;
  try {
    res = await fetch(`${registryUrl}/api/credentials/${encodeURIComponent(agentId)}`);
  } catch (err) {
    console.error('Error: failed to connect to registry —', (err as Error).message);
    process.exit(1);
  }

  if (res.status === 404) {
    console.log('No Verifiable Credentials issued yet.');
    console.log('Credentials are generated automatically as your agent builds reputation.');
    return;
  }

  if (!res.ok) {
    const body = (await res.json()) as Record<string, unknown>;
    console.error(`Error ${res.status}: ${body['error'] ?? 'unknown error'}`);
    process.exit(1);
  }

  const body = (await res.json()) as { credentials: unknown[] };

  if (opts.json) {
    console.log(JSON.stringify(body, null, 2));
    return;
  }

  const credentials = body.credentials;
  if (!credentials || credentials.length === 0) {
    console.log('No Verifiable Credentials issued yet.');
    return;
  }

  console.log(`Verifiable Credentials for ${identity.did ?? `did:agentbnb:${agentId}`}`);
  console.log('────────────────────────────────────────');

  for (const vc of credentials) {
    const vcObj = vc as Record<string, unknown>;
    const types = (vcObj['type'] as string[]) ?? [];
    const credType = types.find((t) => t !== 'VerifiableCredential') ?? 'Unknown';
    const issued = vcObj['issuanceDate'] as string | undefined;
    const subject = vcObj['credentialSubject'] as Record<string, unknown> | undefined;

    console.log(`\n  Type:     ${credType}`);
    if (issued) console.log(`  Issued:   ${issued}`);
    if (subject) {
      for (const [key, val] of Object.entries(subject)) {
        if (key === 'id') continue;
        const display = typeof val === 'object' ? JSON.stringify(val) : String(val);
        console.log(`  ${key}: ${display}`);
      }
    }
  }
}
