import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from './config.js';

/**
 * A registered remote peer — another agent's gateway that this agent can connect to.
 */
export interface PeerConfig {
  /** Human-readable name for this peer (e.g., "alice"). */
  name: string;
  /** Base URL of the peer's gateway (e.g., "http://192.168.1.50:7700"). */
  url: string;
  /** Bearer token for authenticating requests to this peer. */
  token: string;
  /** ISO 8601 timestamp when this peer was registered. */
  added_at: string;
}

/**
 * Returns the path to the peers.json file in the config directory.
 */
function getPeersPath(): string {
  return join(getConfigDir(), 'peers.json');
}

/**
 * Reads all registered peers from peers.json.
 * Returns an empty array if the file does not exist.
 *
 * @returns Array of registered peer configurations.
 */
export function loadPeers(): PeerConfig[] {
  const peersPath = getPeersPath();
  if (!existsSync(peersPath)) {
    return [];
  }

  try {
    const raw = readFileSync(peersPath, 'utf-8');
    return JSON.parse(raw) as PeerConfig[];
  } catch {
    return [];
  }
}

/**
 * Writes the given peers array to peers.json, creating the config directory if needed.
 *
 * @param peers - Full list of peers to persist.
 */
function writePeers(peers: PeerConfig[]): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(getPeersPath(), JSON.stringify(peers, null, 2), 'utf-8');
}

/**
 * Saves a peer to peers.json.
 * If a peer with the same name (case-insensitive) already exists, it is replaced.
 * Otherwise, the peer is appended.
 *
 * @param peer - Peer configuration to save.
 */
export function savePeer(peer: PeerConfig): void {
  const peers = loadPeers();
  const lowerName = peer.name.toLowerCase();
  const existing = peers.findIndex((p) => p.name.toLowerCase() === lowerName);

  if (existing >= 0) {
    peers[existing] = peer;
  } else {
    peers.push(peer);
  }

  writePeers(peers);
}

/**
 * Removes a peer by name (case-insensitive).
 *
 * @param name - Name of the peer to remove.
 * @returns true if the peer was found and removed, false if not found.
 */
export function removePeer(name: string): boolean {
  const peers = loadPeers();
  const lowerName = name.toLowerCase();
  const filtered = peers.filter((p) => p.name.toLowerCase() !== lowerName);

  if (filtered.length === peers.length) {
    return false;
  }

  writePeers(filtered);
  return true;
}

/**
 * Finds a registered peer by name (case-insensitive).
 *
 * @param name - Name of the peer to look up.
 * @returns The PeerConfig if found, or null if not registered.
 */
export function findPeer(name: string): PeerConfig | null {
  const peers = loadPeers();
  const lowerName = name.toLowerCase();
  return peers.find((p) => p.name.toLowerCase() === lowerName) ?? null;
}
