/**
 * OpenClaw integration module — re-exports all public APIs.
 *
 * Use this as the single entry point for importing OpenClaw functionality:
 *
 * ```typescript
 * import { parseSoulMdV2, publishFromSoulV2, generateHeartbeatSection, getOpenClawStatus } from './openclaw/index.js';
 * ```
 */

export { parseSoulMdV2, publishFromSoulV2 } from './soul-sync.js';
export { generateHeartbeatSection, injectHeartbeatSection } from './heartbeat-writer.js';
export { getOpenClawStatus } from './skill.js';
export type { OpenClawStatus, SkillStatus } from './skill.js';
