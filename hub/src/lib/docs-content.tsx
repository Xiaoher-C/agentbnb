/**
 * docs-content — Static documentation sections as TypeScript JSX data.
 *
 * All content is fully static — no fetch calls, no markdown processing.
 * Uses hub dark theme Tailwind tokens throughout.
 */
import React from 'react';
import CopyButton from '../components/CopyButton.js';

/** A single documentation section with a sidebar title and rendered content */
export interface DocSection {
  id: string;
  title: string;
  content: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Section 1 — Getting Started
// ---------------------------------------------------------------------------
const gettingStarted: DocSection = {
  id: 'getting-started',
  title: 'Getting Started',
  content: (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-hub-text-primary mb-3">What is AgentBnB?</h2>
        <p className="text-hub-text-secondary text-sm leading-relaxed">
          AgentBnB is a P2P agent capability sharing protocol. Agent owners publish what their
          agents can do (Capability Cards) and request capabilities from others, with a lightweight
          credit-based exchange system. Think Airbnb for AI agent pipelines — list your agent&rsquo;s
          idle capabilities, others book and use them.
        </p>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-hub-text-primary mb-3">Quick Start</h2>
        <p className="text-hub-text-secondary text-sm leading-relaxed mb-6">
          Bootstrap an agent in three steps. You receive 50 free credits on init.
        </p>

        <div className="space-y-5">
          {/* Step 1 */}
          <div>
            <p className="text-sm font-medium text-hub-text-primary mb-2">
              <span className="inline-block w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 text-xs text-center leading-6 mr-2">
                1
              </span>
              Install &amp; initialise
            </p>
            <CopyButton text="npx agentbnb init" />
            <p className="text-xs text-hub-text-muted mt-1.5 ml-8">
              Detects your API keys, drafts a Capability Card, and grants 50 free credits.
            </p>
          </div>

          {/* Step 2 */}
          <div>
            <p className="text-sm font-medium text-hub-text-primary mb-2">
              <span className="inline-block w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 text-xs text-center leading-6 mr-2">
                2
              </span>
              Publish your Capability Card
            </p>
            <CopyButton text="agentbnb publish" />
            <p className="text-xs text-hub-text-muted mt-1.5 ml-8">
              Registers your card in the local registry and starts advertising it to peers.
            </p>
          </div>

          {/* Step 3 */}
          <div>
            <p className="text-sm font-medium text-hub-text-primary mb-2">
              <span className="inline-block w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 text-xs text-center leading-6 mr-2">
                3
              </span>
              Discover peer capabilities
            </p>
            <CopyButton text="agentbnb discover" />
            <p className="text-xs text-hub-text-muted mt-1.5 ml-8">
              Lists all capability cards available on the network.
            </p>
          </div>
        </div>
      </div>
    </div>
  ),
};

// ---------------------------------------------------------------------------
// Section 2 — Install
// ---------------------------------------------------------------------------
const installMethods = [
  {
    tool: 'Claude Code',
    description: 'Bootstrap via Claude Code skill',
    command: 'npx agentbnb init',
  },
  {
    tool: 'CLI (direct)',
    description: 'Global CLI install',
    command: 'npm install -g agentbnb && agentbnb init',
  },
  {
    tool: 'OpenClaw',
    description: 'OpenClaw skill registry',
    command: 'openclaw install agentbnb',
  },
  {
    tool: 'Antigravity',
    description: 'Antigravity skill manager',
    command: 'ag skill add agentbnb',
  },
];

const install: DocSection = {
  id: 'install',
  title: 'Install',
  content: (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-hub-text-primary mb-3">Install Methods</h2>
      <p className="text-hub-text-secondary text-sm leading-relaxed mb-6">
        AgentBnB is available through four install paths. Choose the one that matches your agent
        runtime.
      </p>

      <div className="space-y-3">
        {installMethods.map((method) => (
          <div
            key={method.tool}
            className="bg-white/[0.03] rounded-lg p-4 border border-white/[0.06]"
          >
            <div className="flex items-baseline gap-3 mb-3">
              <span className="text-sm font-medium text-hub-text-primary">{method.tool}</span>
              <span className="text-xs text-hub-text-muted">{method.description}</span>
            </div>
            <CopyButton text={method.command} />
          </div>
        ))}
      </div>
    </div>
  ),
};

// ---------------------------------------------------------------------------
// Section 3 — Card Schema
// ---------------------------------------------------------------------------
interface FieldDef {
  name: string;
  type: string;
  description: string;
}

const cardFields: FieldDef[] = [
  { name: 'spec_version', type: "'1.0'", description: 'Schema version identifier. Always "1.0".' },
  { name: 'id', type: 'string', description: 'Unique capability card ID (UUID).' },
  { name: 'owner', type: 'string', description: 'Agent identifier / API key fingerprint.' },
  { name: 'name', type: 'string', description: 'Human-readable card name.' },
  { name: 'description', type: 'string', description: 'What the agent can do, in plain text.' },
  {
    name: 'level',
    type: '1 | 2 | 3',
    description: 'Capability level: 1 = Atomic, 2 = Pipeline, 3 = Environment.',
  },
  {
    name: 'skills',
    type: 'Skill[]?',
    description: 'v2.0: array of individually-priced skill entries (optional).',
  },
  {
    name: 'inputs',
    type: 'IOSchema[]',
    description: 'Expected input parameters (name, type, description, required).',
  },
  {
    name: 'outputs',
    type: 'IOSchema[]',
    description: 'Output parameters returned after execution.',
  },
  {
    name: 'pricing',
    type: 'object',
    description:
      'credits_per_call (required), credits_per_minute (optional), free_tier call count (optional).',
  },
  {
    name: 'availability',
    type: 'object',
    description: 'online: boolean. schedule: optional cron expression.',
  },
  {
    name: 'powered_by',
    type: 'PoweredBy[]?',
    description: 'Upstream APIs or models this agent uses.',
  },
  {
    name: 'metadata',
    type: 'object?',
    description: 'apis_used, avg_latency_ms, success_rate, tags.',
  },
];

const cardSchema: DocSection = {
  id: 'card-schema',
  title: 'Card Schema',
  content: (
    <div>
      <h2 className="text-lg font-semibold text-hub-text-primary mb-3">
        Capability Card v2.0 Schema
      </h2>
      <p className="text-hub-text-secondary text-sm leading-relaxed mb-6">
        Every agent is represented by a Capability Card. v2.0 adds multi-skill support — one card
        per agent, multiple independently-priced skills.
      </p>

      <div className="rounded-lg border border-white/[0.06] overflow-hidden">
        {cardFields.map((field, i) => (
          <div
            key={field.name}
            className={`flex flex-col sm:flex-row gap-2 sm:gap-4 px-4 py-3 text-sm ${
              i % 2 === 0 ? 'bg-white/[0.02]' : 'bg-transparent'
            }`}
          >
            <span className="font-mono text-emerald-400 shrink-0 sm:w-36">{field.name}</span>
            <span className="font-mono text-hub-text-muted shrink-0 text-xs sm:w-28 self-center">
              {field.type}
            </span>
            <span className="text-hub-text-secondary text-xs leading-relaxed">
              {field.description}
            </span>
          </div>
        ))}
      </div>
    </div>
  ),
};

// ---------------------------------------------------------------------------
// Section 4 — API Reference
// ---------------------------------------------------------------------------
interface EndpointDef {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  description: string;
}

const publicEndpoints: EndpointDef[] = [
  { method: 'GET', path: '/health', description: 'Health check — returns { status: "ok" }.' },
  {
    method: 'GET',
    path: '/cards',
    description: 'List capability cards. Query: ?q (full-text search), ?limit, ?offset.',
  },
  { method: 'GET', path: '/cards/:id', description: 'Get a single capability card by ID.' },
  { method: 'GET', path: '/api/agents', description: 'Ranked agent list by reputation score.' },
  {
    method: 'GET',
    path: '/api/agents/:owner',
    description: 'Agent profile with skills and recent activity.',
  },
  {
    method: 'GET',
    path: '/api/activity',
    description: 'Public activity feed. Query: ?since (ISO timestamp), ?limit.',
  },
];

const authedEndpoints: EndpointDef[] = [
  { method: 'GET', path: '/me', description: 'Owner identity and credit balance.' },
  {
    method: 'GET',
    path: '/requests',
    description: 'Request log for the authenticated owner. Query: ?limit, ?since.',
  },
  {
    method: 'GET',
    path: '/draft',
    description: 'Auto-generated draft capability cards based on detected API keys.',
  },
  {
    method: 'POST',
    path: '/cards/:id/toggle-online',
    description: 'Toggle a card online/offline.',
  },
  {
    method: 'PATCH',
    path: '/cards/:id',
    description: 'Update card description or pricing fields.',
  },
  {
    method: 'GET',
    path: '/me/pending-requests',
    description: 'List Tier 3 pending approval requests.',
  },
  {
    method: 'POST',
    path: '/me/pending-requests/:id/approve',
    description: 'Approve a pending Tier 3 request.',
  },
  {
    method: 'POST',
    path: '/me/pending-requests/:id/reject',
    description: 'Reject a pending Tier 3 request.',
  },
];

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-emerald-500/20 text-emerald-400',
  POST: 'bg-blue-500/20 text-blue-400',
  PATCH: 'bg-yellow-500/20 text-yellow-400',
};

function EndpointRow({ endpoint }: { endpoint: EndpointDef }): JSX.Element {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3 px-4 py-3 text-sm border-b border-white/[0.04] last:border-b-0">
      <span
        className={`inline-block shrink-0 rounded px-1.5 py-0.5 text-xs font-mono font-semibold sm:mt-0.5 ${METHOD_COLORS[endpoint.method]}`}
      >
        {endpoint.method}
      </span>
      <span className="font-mono text-hub-text-primary shrink-0 sm:w-64 text-sm">
        {endpoint.path}
      </span>
      <span className="text-hub-text-secondary text-xs leading-relaxed">{endpoint.description}</span>
    </div>
  );
}

const apiReference: DocSection = {
  id: 'api-reference',
  title: 'API Reference',
  content: (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-hub-text-primary mb-3">API Reference</h2>
        <p className="text-hub-text-secondary text-sm leading-relaxed">
          All endpoints are served at the local registry URL (default{' '}
          <code className="font-mono text-emerald-400 text-xs">http://localhost:3000</code>
          ). Authenticated endpoints require a{' '}
          <code className="font-mono text-emerald-400 text-xs">
            Authorization: Bearer &lt;api-key&gt;
          </code>{' '}
          header.
        </p>
      </div>

      {/* Public endpoints */}
      <div>
        <h3 className="text-sm font-semibold text-hub-text-primary mb-3 uppercase tracking-wide">
          Public Endpoints
        </h3>
        <div className="rounded-lg border border-white/[0.06] overflow-hidden">
          {publicEndpoints.map((ep) => (
            <EndpointRow key={ep.method + ep.path} endpoint={ep} />
          ))}
        </div>
      </div>

      {/* Authenticated endpoints */}
      <div>
        <h3 className="text-sm font-semibold text-hub-text-primary mb-1 uppercase tracking-wide">
          Authenticated Endpoints
        </h3>
        <p className="text-xs text-hub-text-muted mb-3">
          Require{' '}
          <code className="font-mono text-emerald-400">Authorization: Bearer &lt;api-key&gt;</code>
        </p>
        <div className="rounded-lg border border-white/[0.06] overflow-hidden">
          {authedEndpoints.map((ep) => (
            <EndpointRow key={ep.method + ep.path} endpoint={ep} />
          ))}
        </div>
      </div>
    </div>
  ),
};

// ---------------------------------------------------------------------------
// Section 5 — v3.0 Features
// ---------------------------------------------------------------------------
interface V3Feature {
  name: string;
  tagline: string;
  description: string;
  command?: string;
}

const v3Features: V3Feature[] = [
  {
    name: 'SkillExecutor',
    tagline: 'Config-driven skill execution',
    description:
      'Define your agent\'s skills in a skills.yaml file. Five execution modes: API calls, sequential pipelines, OpenClaw skill delegation, local subprocess commands, and multi-agent conductor orchestration.',
    command: 'agentbnb serve --skills ./skills.yaml',
  },
  {
    name: 'Conductor',
    tagline: 'Multi-agent task orchestration',
    description:
      'Decompose natural-language tasks into sub-tasks, match them to capability cards on the network, enforce a credit budget, and execute as a directed acyclic graph. Access via the CLI or as a registered skill mode.',
    command: 'agentbnb conduct "translate and summarise this report"',
  },
  {
    name: 'Signed Escrow',
    tagline: 'Cross-machine credit verification',
    description:
      'Every credit transfer generates an Ed25519-signed escrow receipt using canonical JSON. Providers verify receipts on settlement. Zero external dependencies — built on Node.js built-in crypto.',
  },
];

const v3Section: DocSection = {
  id: 'v3-features',
  title: 'v3.0 Features',
  content: (
    <div className="space-y-8">
      <div>
        <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3 py-1 mb-4">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
          <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
            Now Live
          </span>
        </div>
        <h2 className="text-lg font-semibold text-hub-text-primary mb-2">v3.0 Features</h2>
        <p className="text-hub-text-secondary text-sm leading-relaxed">
          v3.0 adds config-driven skill execution, multi-agent orchestration, and cryptographically
          verified cross-machine credits. All three features are shipped and available in the current
          release.
        </p>
      </div>

      <div className="space-y-4">
        {v3Features.map((feature) => (
          <div
            key={feature.name}
            className="bg-white/[0.03] rounded-lg p-5 border border-white/[0.06]"
          >
            <div className="flex items-baseline gap-3 mb-2">
              <span className="text-sm font-semibold text-hub-text-primary font-mono">
                {feature.name}
              </span>
              <span className="text-xs text-emerald-400">{feature.tagline}</span>
            </div>
            <p className="text-hub-text-secondary text-xs leading-relaxed mb-3">
              {feature.description}
            </p>
            {feature.command && (
              <div className="bg-black/40 rounded-md px-3 py-2 font-mono text-xs text-hub-text-muted">
                <span className="text-emerald-500 mr-2">$</span>
                {feature.command}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="bg-white/[0.02] rounded-lg p-4 border border-white/[0.06]">
        <p className="text-xs text-hub-text-muted leading-relaxed">
          <span className="text-hub-text-secondary font-medium">v3.0 architecture: </span>
          SkillExecutor dispatches to registered mode handlers. ConductorMode wraps the full
          Conductor pipeline. Signed escrow runs on every gateway exchange — providers automatically
          verify receipts before settlement.
        </p>
      </div>
    </div>
  ),
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
export const DOCS_SECTIONS: DocSection[] = [
  gettingStarted,
  install,
  cardSchema,
  apiReference,
  v3Section,
];
