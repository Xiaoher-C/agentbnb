import { Bonjour } from 'bonjour-service';

/**
 * A discovered agent on the local network.
 */
export interface DiscoveredAgent {
  /** Service name (typically the agent owner name) */
  name: string;
  /** Gateway URL constructed from service host/addresses and port */
  url: string;
  /** Owner identifier from the txt record or service name */
  owner: string;
}

/** Module-level Bonjour singleton — lazy-initialized to avoid multiple instances. */
let bonjourInstance: InstanceType<typeof Bonjour> | null = null;

/**
 * Get (or create) the module-level Bonjour singleton.
 */
function getBonjour(): InstanceType<typeof Bonjour> {
  if (bonjourInstance === null) {
    bonjourInstance = new Bonjour();
  }
  return bonjourInstance;
}

/**
 * Announce this agent's gateway on the local network via mDNS.
 *
 * Publishes a service with type 'agentbnb', name=owner, port=port.
 * The txt record includes { owner, version: '1.0' } merged with any additional metadata.
 *
 * @param owner - The agent owner identifier (used as the service name)
 * @param port - The gateway port to announce
 * @param metadata - Optional additional txt record fields
 */
export function announceGateway(
  owner: string,
  port: number,
  metadata?: Record<string, string>,
): void {
  const bonjour = getBonjour();
  const txt: Record<string, string> = {
    owner,
    version: '1.0',
    ...metadata,
  };

  bonjour.publish({
    name: owner,
    type: 'agentbnb',
    port,
    txt,
  });
}

/**
 * Browse for AgentBnB agents on the local network via mDNS.
 *
 * Constructs the agent URL from service.addresses[0] (preferring IPv4) + port.
 * Returns an object with a stop() method to end browsing.
 *
 * @param onFound - Callback invoked when an agent is discovered
 * @param onDown - Optional callback invoked when an agent goes offline
 * @returns Object with stop() method to end browsing
 */
export function discoverLocalAgents(
  onFound: (agent: DiscoveredAgent) => void,
  onDown?: (agent: DiscoveredAgent) => void,
): { stop: () => void } {
  const bonjour = getBonjour();
  const browser = bonjour.find({ type: 'agentbnb' });

  browser.on('up', (service) => {
    // Prefer IPv4 addresses — filter out IPv6 addresses (contain ':')
    const addresses: string[] = (service.addresses ?? []) as string[];
    const ipv4Addresses = addresses.filter((addr) => !addr.includes(':'));
    const host = ipv4Addresses.length > 0 ? ipv4Addresses[0] : service.host;

    const url = `http://${host}:${service.port}`;
    const owner =
      (service.txt as Record<string, string> | undefined)?.owner ?? service.name;

    onFound({
      name: service.name,
      url,
      owner,
    });
  });

  if (onDown) {
    browser.on('down', (service) => {
      const addresses: string[] = (service.addresses ?? []) as string[];
      const ipv4Addresses = addresses.filter((addr) => !addr.includes(':'));
      const host = ipv4Addresses.length > 0 ? ipv4Addresses[0] : service.host;

      const url = `http://${host}:${service.port}`;
      const owner =
        (service.txt as Record<string, string> | undefined)?.owner ?? service.name;

      onDown({
        name: service.name,
        url,
        owner,
      });
    });
  }

  return {
    stop: () => browser.stop(),
  };
}

/**
 * Stop announcing this agent and clean up the Bonjour instance.
 *
 * Unpublishes all services and destroys the Bonjour instance.
 * Safe to call multiple times (idempotent).
 *
 * @returns Promise that resolves when cleanup is complete
 */
export async function stopAnnouncement(): Promise<void> {
  if (bonjourInstance === null) {
    return;
  }

  const instance = bonjourInstance;
  bonjourInstance = null;

  await new Promise<void>((resolve) => {
    instance.unpublishAll(() => {
      instance.destroy();
      resolve();
    });
  });
}
