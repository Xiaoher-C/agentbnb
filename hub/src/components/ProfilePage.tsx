/**
 * ProfilePage — Hub v2 individual agent profile page at /agents/:owner.
 *
 * 6-module layout:
 *   1. Identity Header  — avatar, name, badges, performance tier, joined/last active
 *   2. Capability Panel — skills, ideal_for, not_suitable_for
 *   3. Authority Card   — authority_source, verification_status, scope, constraints
 *   4. Trust Metrics    — execution stats + 7d trend
 *   5. Execution Proof  — recent proofs with outcome_class + proof_source indicator
 *   6. Learning         — known_limitations, failure patterns, recent improvements
 *
 * Design principle: Hub v2 shows who agents are, why they're trusted,
 * what they're authorized to do, what actually happened, and how they improve.
 */
import Avatar from 'boring-avatars';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router';
import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useAgentProfile } from '../hooks/useAgents.js';
import { useDidDocument } from '../hooks/useDidDocument.js';
import {
  useCredentials,
  type VerifiableCredential,
  type ReputationCredentialSubject,
  type SkillCredentialSubject,
  type TeamCredentialSubject,
} from '../hooks/useCredentials.js';
import type { AppOutletContext, ExecutionProof, HubCard } from '../types.js';
import CapabilityCard from './CapabilityCard.js';
import CredentialBadge from './CredentialBadge.js';

function timeAgo(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  return `${diffDay}d ago`;
}

/**
 * Returns the first skill's agent_id. v2.0 cards carry an Ed25519 pubkey hash;
 * v1.0 cards do not, so this can be undefined.
 */
function findAgentId(skills: HubCard[]): string | undefined {
  return skills.find((s) => s.agent_id)?.agent_id;
}

/** Shortens an agent_id to `first8…last4` for DID chip display. */
function shortenAgentId(agentId: string): string {
  if (agentId.length <= 12) return agentId;
  return `${agentId.slice(0, 8)}…${agentId.slice(-4)}`;
}

/**
 * DidIdentity — Renders the v9.0 DID chip, copy button, and (optionally)
 * the resolved gateway endpoint line.
 *
 * Silent no-op when agent_id is undefined (v1.0 cards, or agents without
 * cryptographic identity published). Clipboard failures are swallowed —
 * the button stays in its resting state.
 */
function DidIdentity({ agentId }: { agentId: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const { gatewayEndpoint } = useDidDocument(agentId);
  const did = `did:agentbnb:${agentId}`;
  const displayDid = `did:agentbnb:${shortenAgentId(agentId)}`;

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(did);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — leave button in resting state.
    }
  };

  return (
    <div className="mt-2 flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span
          className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-white/[0.05] border border-hub-border text-hub-text-secondary"
          title={did}
        >
          {displayDid}
        </span>
        <button
          type="button"
          onClick={() => { void handleCopy(); }}
          className="text-hub-text-muted hover:text-hub-text-primary transition-colors"
          aria-label={copied ? 'DID copied' : 'Copy DID'}
          title={copied ? 'Copied' : 'Copy DID'}
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </button>
        {copied && (
          <span className="text-[11px] text-emerald-400" role="status">
            Copied
          </span>
        )}
      </div>
      {gatewayEndpoint && (
        <p className="text-[11px] font-mono text-hub-text-muted truncate" title={gatewayEndpoint}>
          {gatewayEndpoint}
        </p>
      )}
    </div>
  );
}

const TIER_CONFIG: Record<0 | 1 | 2, { label: string; cls: string }> = {
  0: { label: 'Listed', cls: 'bg-white/[0.04] text-hub-text-muted border border-hub-border' },
  1: { label: 'Active', cls: 'bg-blue-400/10 text-blue-400 border border-blue-400/20' },
  2: { label: 'Trusted', cls: 'bg-emerald-400/10 text-emerald-400 border border-emerald-400/20' },
};

const BADGE_CONFIG: Record<string, { label: string; cls: string }> = {
  platform_verified: { label: '✓ Verified', cls: 'bg-emerald-400/10 text-emerald-400 border border-emerald-400/20' },
  org_authorized: { label: '🏢 Org Authorized', cls: 'bg-blue-400/10 text-blue-400 border border-blue-400/20' },
  real_world_authorized: { label: '🌐 Real-World', cls: 'bg-violet-400/10 text-violet-400 border border-violet-400/20' },
};

const OUTCOME_CONFIG: Record<string, { cls: string; label: string }> = {
  completed: { cls: 'text-emerald-400', label: 'success' },
  partial: { cls: 'text-amber-400', label: 'partial' },
  failed: { cls: 'text-red-400', label: 'failed' },
  cancelled: { cls: 'text-amber-400', label: 'timeout' },
};

const AUTH_SOURCE_LABELS: Record<string, string> = {
  self: 'Self-declared capability',
  platform: 'Platform-observed provider',
  org: 'Organization-authorized',
};

const VERIFICATION_STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  none: { label: 'No verification', cls: 'text-hub-text-muted' },
  observed: { label: 'Platform observed', cls: 'text-blue-400' },
  verified: { label: 'Verified', cls: 'text-emerald-400' },
  revoked: { label: 'Revoked', cls: 'text-red-400' },
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[13px] font-semibold text-hub-text-muted uppercase tracking-wider mb-4">
      {children}
    </h3>
  );
}

type VcKind = 'reputation' | 'skill' | 'team' | 'unknown';

function classifyVc(vc: VerifiableCredential): VcKind {
  if (vc.type.includes('AgentReputationCredential')) return 'reputation';
  if (vc.type.includes('AgentSkillCredential')) return 'skill';
  if (vc.type.includes('AgentTeamCredential')) return 'team';
  return 'unknown';
}

function CredentialsList({ credentials }: { credentials: VerifiableCredential[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {credentials.map((vc, i) => {
        const kind = classifyVc(vc);
        const verified = Boolean(vc.proof);
        if (kind === 'reputation') {
          const s = vc.credentialSubject as ReputationCredentialSubject;
          return (
            <CredentialBadge
              key={i}
              type="reputation"
              successRate={s.successRate}
              totalTransactions={s.totalTransactions}
              issuedAt={vc.issuanceDate}
              verified={verified}
            />
          );
        }
        if (kind === 'skill') {
          const s = vc.credentialSubject as SkillCredentialSubject;
          return (
            <CredentialBadge
              key={i}
              type="skill"
              skillName={s.skillId}
              milestone={s.milestone}
              issuedAt={vc.issuanceDate}
              verified={verified}
            />
          );
        }
        if (kind === 'team') {
          const s = vc.credentialSubject as TeamCredentialSubject;
          return (
            <CredentialBadge
              key={i}
              type="team"
              teamRole={s.teamRole}
              teamSize={s.teamSize}
              issuedAt={vc.issuanceDate}
              verified={verified}
            />
          );
        }
        return null;
      })}
    </div>
  );
}

function ProofSourceBadge({ source }: { source: ExecutionProof['proof_source'] }) {
  if (source === 'signed_receipt') {
    return <span className="text-[10px] text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded px-1.5 py-0.5">🔐 Signed</span>;
  }
  if (source === 'settlement_record') {
    return <span className="text-[10px] text-blue-400 bg-blue-400/10 border border-blue-400/20 rounded px-1.5 py-0.5">⚡ Settled</span>;
  }
  return <span className="text-[10px] text-hub-text-muted bg-white/[0.03] border border-hub-border rounded px-1.5 py-0.5">Request log</span>;
}

export default function ProfilePage(): JSX.Element {
  const { owner } = useParams<{ owner: string }>();
  const navigate = useNavigate();
  const { setSelectedCard } = useOutletContext<AppOutletContext>();
  const { profileV2, loading, error } = useAgentProfile(owner ?? '');
  const credentialsAgentId = profileV2?.skills.find((s) => s.agent_id)?.agent_id;
  const { credentials, loading: credsLoading, error: credsError } = useCredentials(credentialsAgentId);

  useEffect(() => {
    if (!owner) void navigate('/agents');
  }, [owner, navigate]);

  if (loading) {
    return (
      <div className="space-y-4 max-w-4xl mx-auto">
        <Link to="/agents" className="text-hub-text-tertiary hover:text-hub-text-secondary text-sm inline-block">
          ← Back to Agents
        </Link>
        <div className="bg-white/[0.06] animate-pulse rounded-xl h-28" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white/[0.06] animate-pulse rounded-xl h-40" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !profileV2) {
    return (
      <div className="py-12 text-center max-w-4xl mx-auto">
        <Link to="/agents" className="text-hub-text-tertiary hover:text-hub-text-secondary text-sm inline-block mb-4">
          ← Back to Agents
        </Link>
        <p className="text-red-400 mt-4">{error ?? 'Agent not found'}</p>
      </div>
    );
  }

  const { trust_metrics: tm, execution_proofs, authority, suitability, learning, verification_badges, performance_tier } = profileV2;
  const tierCfg = TIER_CONFIG[performance_tier];
  const displayName = profileV2.agent_name ?? profileV2.owner;
  const agentId = findAgentId(profileV2.skills);

  return (
    <div className="max-w-4xl mx-auto">
      <Link to="/agents" className="text-hub-text-tertiary hover:text-hub-text-secondary text-sm inline-block mb-6">
        ← Back to Agents
      </Link>

      {/* ── Module 1: Identity Header ── */}
      <div className="bg-hub-surface border border-hub-border rounded-xl p-6 mb-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
          <Avatar
            size={56}
            name={profileV2.owner}
            variant="marble"
            colors={['#10B981', '#059669', '#047857', '#065F46', '#064E3B']}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-hub-text-primary">{displayName}</h1>
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${tierCfg.cls}`}>
                {tierCfg.label}
              </span>
              {verification_badges.map((badge) => {
                const cfg = BADGE_CONFIG[badge];
                return cfg ? (
                  <span key={badge} className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${cfg.cls}`}>
                    {cfg.label}
                  </span>
                ) : null;
              })}
            </div>
            {profileV2.short_description && (
              <p className="text-hub-text-secondary mt-1 text-sm">{profileV2.short_description}</p>
            )}
            {agentId && <DidIdentity agentId={agentId} />}
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-hub-text-tertiary">
              <span>@{profileV2.owner}</span>
              <span>Joined {new Date(profileV2.joined_at).toLocaleDateString()}</span>
              <span>Active {timeAgo(profileV2.last_active)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main content: 2-column on large screens ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* Left column (wider) */}
        <div className="lg:col-span-3 space-y-4">

          {/* ── Module 2: Capability Panel ── */}
          <div className="bg-hub-surface border border-hub-border rounded-xl p-6">
            <SectionTitle>Capabilities</SectionTitle>
            {profileV2.skills.length === 0 ? (
              <p className="text-hub-text-muted text-sm">No skills published yet.</p>
            ) : (
              <div className="space-y-3">
                {profileV2.skills.map((skill) => (
                  <CapabilityCard
                    key={skill.id}
                    card={{ ...skill, performance_tier, authority_source: authority.authority_source }}
                    onClick={() => setSelectedCard(skill)}
                  />
                ))}
              </div>
            )}
            {/* Suitability */}
            {suitability && (suitability.ideal_for?.length || suitability.not_suitable_for?.length) && (
              <div className="mt-4 space-y-3 pt-4 border-t border-hub-border">
                {suitability.ideal_for && suitability.ideal_for.length > 0 && (
                  <div>
                    <p className="text-[11px] font-medium text-emerald-400 uppercase tracking-wider mb-1.5">Ideal for</p>
                    <ul className="space-y-1">
                      {suitability.ideal_for.map((item, i) => (
                        <li key={i} className="text-sm text-hub-text-secondary flex gap-2">
                          <span className="text-emerald-400 mt-0.5">·</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {suitability.not_suitable_for && suitability.not_suitable_for.length > 0 && (
                  <div>
                    <p className="text-[11px] font-medium text-amber-400 uppercase tracking-wider mb-1.5">Not suitable for</p>
                    <ul className="space-y-1">
                      {suitability.not_suitable_for.map((item, i) => (
                        <li key={i} className="text-sm text-hub-text-secondary flex gap-2">
                          <span className="text-amber-400 mt-0.5">·</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {suitability.risk_conditions && suitability.risk_conditions.length > 0 && (
                  <div>
                    <p className="text-[11px] font-medium text-red-400 uppercase tracking-wider mb-1.5">Risk conditions</p>
                    <ul className="space-y-1">
                      {suitability.risk_conditions.map((item, i) => (
                        <li key={i} className="text-sm text-hub-text-secondary flex gap-2">
                          <span className="text-red-400 mt-0.5">⚠</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Module 5: Execution Proof ── */}
          <div className="bg-hub-surface border border-hub-border rounded-xl p-6">
            <SectionTitle>Execution Proof</SectionTitle>
            {execution_proofs.length === 0 ? (
              <p className="text-hub-text-muted text-sm">No executions recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {execution_proofs.map((proof, i) => {
                  const outcomeConf = OUTCOME_CONFIG[proof.outcome_class] ?? OUTCOME_CONFIG.failed;
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
                    >
                      <span className={`text-xs font-medium w-14 flex-shrink-0 ${outcomeConf.cls}`}>
                        {outcomeConf.label}
                      </span>
                      <span className="text-sm text-hub-text-secondary truncate flex-1">{proof.action}</span>
                      {proof.latency_ms !== undefined && (
                        <span className="text-xs text-hub-text-tertiary flex-shrink-0">
                          {proof.latency_ms < 1000 ? `${proof.latency_ms}ms` : `${(proof.latency_ms / 1000).toFixed(1)}s`}
                        </span>
                      )}
                      <ProofSourceBadge source={proof.proof_source} />
                      <span className="text-xs text-hub-text-muted flex-shrink-0">{timeAgo(proof.timestamp)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Module 6: Learning ── */}
          <div className="bg-hub-surface border border-hub-border rounded-xl p-6">
            <SectionTitle>Learning & Evolution</SectionTitle>
            {learning.known_limitations.length === 0 &&
             learning.common_failure_patterns.length === 0 &&
             learning.recent_improvements.length === 0 &&
             learning.critiques.length === 0 ? (
              <p className="text-hub-text-muted text-sm">No learning signals published yet.</p>
            ) : (
              <div className="space-y-4">
                {learning.known_limitations.length > 0 && (
                  <div>
                    <p className="text-[11px] font-medium text-hub-text-muted uppercase tracking-wider mb-2">Known Limitations</p>
                    <ul className="space-y-1">
                      {learning.known_limitations.map((item, i) => (
                        <li key={i} className="text-sm text-hub-text-secondary flex gap-2">
                          <span className="text-hub-text-muted mt-0.5">·</span>{item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {learning.common_failure_patterns.length > 0 && (
                  <div>
                    <p className="text-[11px] font-medium text-amber-400/70 uppercase tracking-wider mb-2">Common Failure Patterns</p>
                    <ul className="space-y-1">
                      {learning.common_failure_patterns.map((item, i) => (
                        <li key={i} className="text-sm text-hub-text-secondary flex gap-2">
                          <span className="text-amber-400/70 mt-0.5">△</span>{item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {learning.recent_improvements.length > 0 && (
                  <div>
                    <p className="text-[11px] font-medium text-emerald-400/70 uppercase tracking-wider mb-2">Recent Improvements</p>
                    <ul className="space-y-2">
                      {learning.recent_improvements.map((imp, i) => (
                        <li key={i} className="flex gap-3">
                          <span className="text-[11px] font-mono text-hub-text-muted bg-white/[0.04] px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5">
                            v{imp.version}
                          </span>
                          <div>
                            <p className="text-sm text-hub-text-secondary">{imp.summary}</p>
                            <p className="text-xs text-hub-text-muted">{timeAgo(imp.timestamp)}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right column (narrower) */}
        <div className="lg:col-span-2 space-y-4">

          {/* ── Module 3: Authority Card ── */}
          <div className="bg-hub-surface border border-hub-border rounded-xl p-6">
            <SectionTitle>Authority</SectionTitle>
            <div className="space-y-3">
              <div>
                <p className="text-[11px] text-hub-text-muted mb-1">Source</p>
                <p className="text-sm text-hub-text-secondary">{AUTH_SOURCE_LABELS[authority.authority_source] ?? authority.authority_source}</p>
              </div>
              <div>
                <p className="text-[11px] text-hub-text-muted mb-1">Status</p>
                <p className={`text-sm font-medium ${VERIFICATION_STATUS_CONFIG[authority.verification_status]?.cls ?? 'text-hub-text-muted'}`}>
                  {VERIFICATION_STATUS_CONFIG[authority.verification_status]?.label ?? authority.verification_status}
                </p>
              </div>
              {authority.scope && authority.scope.length > 0 && (
                <div>
                  <p className="text-[11px] text-hub-text-muted mb-1.5">Scope</p>
                  <div className="flex flex-wrap gap-1.5">
                    {authority.scope.map((s) => (
                      <span key={s} className="text-[11px] font-mono bg-white/[0.04] border border-hub-border px-2 py-0.5 rounded text-hub-text-secondary">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {authority.expires_at && (
                <div>
                  <p className="text-[11px] text-hub-text-muted mb-1">Expires</p>
                  <p className="text-sm text-hub-text-secondary">{new Date(authority.expires_at).toLocaleDateString()}</p>
                </div>
              )}
            </div>
          </div>

          {/* ── Module 4: Trust Metrics ── */}
          <div className="bg-hub-surface border border-hub-border rounded-xl p-6">
            <SectionTitle>Trust Metrics</SectionTitle>
            <div className="space-y-3">
              {[
                { label: 'Total executions', value: tm.total_executions.toLocaleString() },
                { label: 'Successful', value: `${tm.successful_executions.toLocaleString()} (${Math.round(tm.success_rate * 100)}%)` },
                { label: 'Avg latency', value: tm.avg_latency_ms > 0 ? (tm.avg_latency_ms < 1000 ? `${tm.avg_latency_ms}ms` : `${(tm.avg_latency_ms / 1000).toFixed(1)}s`) : '—' },
                { label: 'Failure rate', value: `${Math.round(tm.refund_rate * 100)}%` },
                { label: 'Repeat use', value: `${Math.round(tm.repeat_use_rate * 100)}%` },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between items-baseline">
                  <span className="text-xs text-hub-text-muted">{label}</span>
                  <span className="text-sm font-mono text-hub-text-secondary">{value}</span>
                </div>
              ))}

              {/* 7d trend mini bar chart */}
              {tm.trend_7d.length > 0 && (
                <div className="pt-3 mt-1 border-t border-hub-border">
                  <p className="text-[11px] text-hub-text-muted mb-2">Last 7 days</p>
                  <div className="flex items-end gap-1 h-10">
                    {tm.trend_7d.map((day, i) => {
                      const maxCount = Math.max(...tm.trend_7d.map((d) => d.count), 1);
                      const heightPct = day.count > 0 ? Math.max((day.count / maxCount) * 100, 10) : 4;
                      const successPct = day.count > 0 ? (day.success / day.count) * 100 : 0;
                      return (
                        <div
                          key={i}
                          className="flex-1 rounded-sm min-h-[2px] relative"
                          title={`${day.date}: ${day.count} runs, ${day.success} success`}
                          style={{
                            height: `${heightPct}%`,
                            background: successPct >= 80
                              ? 'rgba(52,211,153,0.6)'
                              : successPct >= 50
                              ? 'rgba(251,191,36,0.5)'
                              : 'rgba(248,113,113,0.5)',
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Credentials (Verifiable Credentials) ── */}
          {agentId && !credsError && (
            <div className="bg-hub-surface border border-hub-border rounded-xl p-6">
              <SectionTitle>Credentials</SectionTitle>
              {credsLoading ? (
                <div className="space-y-2">
                  <div className="bg-white/[0.04] animate-pulse rounded-full h-6 w-32" />
                  <div className="bg-white/[0.04] animate-pulse rounded-full h-6 w-40" />
                </div>
              ) : credentials.length === 0 ? (
                <p className="text-hub-text-muted text-sm">
                  No credentials issued yet — credentials are issued after successful executions and refreshed weekly.
                </p>
              ) : (
                <CredentialsList credentials={credentials} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
