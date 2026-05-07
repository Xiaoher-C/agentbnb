/**
 * CreateAgentPage — 4-step wizard to create a new Hub-hosted rentable agent
 * (v10 Agent Maturity Rental).
 *
 * The underlying POST /api/hub-agents API is unchanged; only the user-facing
 * copy is reframed for v10. Skills under the agent remain a substrate concept
 * — operators see them as "tools the rentable agent can execute".
 *
 * Step 1: Agent name + what the agent is good at
 * Step 2: Tools (direct_api / relay / queue) — what the rentable agent can do
 * Step 3: Secrets (optional key-value pairs) — execute on your machine
 * Step 4: Review + create via POST /api/hub-agents
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Check } from 'lucide-react';

/** Wizard step type */
type WizardStep = 1 | 2 | 3 | 4;

/** Routing mode options */
type RoutingMode = 'direct_api' | 'relay' | 'queue';

/** Skill route form state */
interface SkillRouteForm {
  skill_id: string;
  mode: RoutingMode;
  // direct_api fields
  name: string;
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  credits_per_call: number;
  // relay / queue fields
  relay_owner: string;
}

/** Secret form state */
interface SecretEntry {
  key: string;
  value: string;
}

const inputClass =
  'w-full bg-white/[0.06] border border-hub-border rounded-lg px-3 py-2 text-hub-text-primary placeholder:text-hub-text-tertiary focus:border-hub-accent focus:outline-none text-sm';
const labelClass = 'block text-sm text-hub-text-secondary mb-1';
const primaryBtn =
  'bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const secondaryBtn =
  'bg-white/[0.06] hover:bg-white/[0.08] text-hub-text-secondary px-4 py-2 rounded-lg text-sm font-medium transition-colors';

function emptySkillRoute(): SkillRouteForm {
  return {
    skill_id: '',
    mode: 'direct_api',
    name: '',
    endpoint: '',
    method: 'POST',
    credits_per_call: 10,
    relay_owner: '',
  };
}

/**
 * Step indicator showing 4 circles connected by lines.
 */
function StepIndicator({ current }: { current: WizardStep }): JSX.Element {
  const steps = [
    { num: 1 as const, label: 'Agent' },
    { num: 2 as const, label: 'Tools' },
    { num: 3 as const, label: 'Secrets' },
    { num: 4 as const, label: 'Review' },
  ];

  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {steps.map((step, i) => {
        const isCompleted = step.num < current;
        const isCurrent = step.num === current;

        return (
          <div key={step.num} className="flex items-center">
            {/* Circle */}
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium border-2 transition-colors ${
                  isCompleted
                    ? 'bg-emerald-600 border-emerald-600 text-white'
                    : isCurrent
                      ? 'border-emerald-500 text-emerald-400 bg-transparent'
                      : 'border-hub-border text-hub-text-tertiary bg-transparent'
                }`}
              >
                {isCompleted ? <Check className="w-4 h-4" /> : step.num}
              </div>
              <span className={`text-xs mt-1 ${isCurrent ? 'text-hub-text-primary' : 'text-hub-text-tertiary'}`}>
                {step.label}
              </span>
            </div>
            {/* Connector line (not after last) */}
            {i < steps.length - 1 && (
              <div
                className={`w-12 h-0.5 mb-5 mx-1 ${
                  step.num < current ? 'bg-emerald-600' : 'bg-hub-border'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Mode selector radio-style buttons.
 */
function ModeSelector({
  value,
  onChange,
}: {
  value: RoutingMode;
  onChange: (m: RoutingMode) => void;
}): JSX.Element {
  const modes: { id: RoutingMode; label: string }[] = [
    { id: 'direct_api', label: 'API' },
    { id: 'relay', label: 'Relay' },
    { id: 'queue', label: 'Queue' },
  ];

  return (
    <div className="flex gap-1">
      {modes.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => onChange(m.id)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            value === m.id
              ? 'bg-emerald-600 text-white'
              : 'bg-white/[0.06] text-hub-text-secondary hover:bg-white/[0.08]'
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Renders the 4-step create agent wizard.
 */
export default function CreateAgentPage(): JSX.Element {
  const navigate = useNavigate();
  const [step, setStep] = useState<WizardStep>(1);

  // Step 1: Name
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  // Step 2: Skills
  const [skills, setSkills] = useState<SkillRouteForm[]>([emptySkillRoute()]);

  // Step 3: Secrets
  const [secrets, setSecrets] = useState<SecretEntry[]>([]);

  // Step 4: Submit state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // --- Skill helpers ---
  function updateSkill(index: number, patch: Partial<SkillRouteForm>): void {
    setSkills((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function removeSkill(index: number): void {
    setSkills((prev) => prev.filter((_, i) => i !== index));
  }

  function addSkill(): void {
    setSkills((prev) => [...prev, emptySkillRoute()]);
  }

  // --- Secret helpers ---
  function updateSecret(index: number, patch: Partial<SecretEntry>): void {
    setSecrets((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function removeSecret(index: number): void {
    setSecrets((prev) => prev.filter((_, i) => i !== index));
  }

  function addSecret(): void {
    setSecrets((prev) => [...prev, { key: '', value: '' }]);
  }

  // --- Validation ---
  const canProceedStep1 = name.trim().length > 0;
  const canProceedStep2 = skills.length > 0 && skills.every((s) => {
    if (!s.skill_id.trim()) return false;
    if (s.mode === 'direct_api') return s.endpoint.trim().length > 0;
    return s.relay_owner.trim().length > 0;
  });

  // --- Build payload ---
  function buildPayload(): { name: string; skill_routes: unknown[]; secrets?: Record<string, string> } {
    const skill_routes = skills.map((s) => {
      if (s.mode === 'direct_api') {
        return {
          skill_id: s.skill_id,
          mode: 'direct_api' as const,
          config: {
            id: s.skill_id,
            type: 'api' as const,
            name: s.name || s.skill_id,
            endpoint: s.endpoint,
            method: s.method,
            pricing: { credits_per_call: s.credits_per_call },
          },
        };
      }
      return {
        skill_id: s.skill_id,
        mode: s.mode,
        config: { relay_owner: s.relay_owner },
      };
    });

    const secretsObj: Record<string, string> = {};
    for (const entry of secrets) {
      if (entry.key.trim() && entry.value.trim()) {
        secretsObj[entry.key.trim()] = entry.value;
      }
    }

    return {
      name: name.trim(),
      skill_routes,
      ...(Object.keys(secretsObj).length > 0 ? { secrets: secretsObj } : {}),
    };
  }

  async function handleSubmit(): Promise<void> {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload = buildPayload();
      const res = await fetch('/api/hub-agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `Server returned ${res.status}`);
      }
      const data = (await res.json()) as { agent_id: string };
      void navigate(`/agents/hub/${data.agent_id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setSubmitError(`Failed to create agent: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <Link to="/agents/hub" className="text-hub-text-tertiary hover:text-hub-text-secondary text-sm mb-4 inline-block">
        &larr; Back to Hub Agents
      </Link>

      <h2 className="text-xl font-semibold text-hub-text-primary mt-2 mb-2">
        Create a rentable agent
      </h2>
      <p className="text-sm text-hub-text-secondary mb-6 max-w-2xl">
        Configure the agent renters will book a 60-minute session with. Tools run on the
        runtime you wire up here; conversations stay isolated per rental session
        (<a
          href="https://github.com/Xiaoher-C/agentbnb/blob/main/docs/adr/024-privacy-boundary.md"
          target="_blank"
          rel="noopener noreferrer"
          className="text-emerald-400 underline hover:text-emerald-300"
        >ADR-024 privacy contract</a>).
      </p>

      <StepIndicator current={step} />

      {/* Step 1: Agent */}
      {step === 1 && (
        <div className="max-w-lg mx-auto space-y-4">
          <div>
            <label className={labelClass}>Agent name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Translation Agent"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>What this agent is good at (renters read this first)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Six months of Anthropic-tuned EN→JA technical translation. Best at API docs and changelogs."
              rows={3}
              className={inputClass}
            />
          </div>
          <div className="flex justify-end pt-2">
            <button
              disabled={!canProceedStep1}
              onClick={() => setStep(2)}
              className={primaryBtn}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Tools */}
      {step === 2 && (
        <div className="max-w-2xl mx-auto space-y-4">
          <p className="text-sm text-hub-text-secondary">
            Add the tools your agent runs during a rental session. Each tool executes on
            your runtime — renters only see results, not your keys.
          </p>
          {skills.map((skill, i) => (
            <div key={i} className="bg-white/[0.02] border border-hub-border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-hub-text-primary">Tool {i + 1}</span>
                {skills.length > 1 && (
                  <button
                    onClick={() => removeSkill(i)}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    Remove
                  </button>
                )}
              </div>

              <div>
                <label className={labelClass}>Tool ID *</label>
                <input
                  type="text"
                  value={skill.skill_id}
                  onChange={(e) => updateSkill(i, { skill_id: e.target.value })}
                  placeholder="translate-text"
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Routing Mode</label>
                <ModeSelector value={skill.mode} onChange={(mode) => updateSkill(i, { mode })} />
              </div>

              {skill.mode === 'direct_api' && (
                <>
                  <div>
                    <label className={labelClass}>Tool name</label>
                    <input
                      type="text"
                      value={skill.name}
                      onChange={(e) => updateSkill(i, { name: e.target.value })}
                      placeholder="Translate Text"
                      className={inputClass}
                    />
                  </div>
                  <div className="grid grid-cols-[1fr_120px] gap-3">
                    <div>
                      <label className={labelClass}>Endpoint URL *</label>
                      <input
                        type="text"
                        value={skill.endpoint}
                        onChange={(e) => updateSkill(i, { endpoint: e.target.value })}
                        placeholder="https://api.example.com/translate"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Method</label>
                      <select
                        value={skill.method}
                        onChange={(e) => updateSkill(i, { method: e.target.value as SkillRouteForm['method'] })}
                        className={inputClass}
                      >
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                        <option value="DELETE">DELETE</option>
                      </select>
                    </div>
                  </div>
                  <div className="w-40">
                    <label className={labelClass}>Credits / Call</label>
                    <input
                      type="number"
                      min={1}
                      value={skill.credits_per_call}
                      onChange={(e) => updateSkill(i, { credits_per_call: parseInt(e.target.value, 10) || 1 })}
                      className={inputClass}
                    />
                    <p className="text-xs text-hub-text-tertiary mt-1">
                      Substrate cost. Set per-session price on the Publish page.
                    </p>
                  </div>
                </>
              )}

              {(skill.mode === 'relay' || skill.mode === 'queue') && (
                <div>
                  <label className={labelClass}>Relay Owner *</label>
                  <input
                    type="text"
                    value={skill.relay_owner}
                    onChange={(e) => updateSkill(i, { relay_owner: e.target.value })}
                    placeholder="agent-owner-name"
                    className={inputClass}
                  />
                </div>
              )}
            </div>
          ))}

          <button onClick={addSkill} className={secondaryBtn}>
            + Add tool
          </button>

          <div className="flex justify-between pt-2">
            <button onClick={() => setStep(1)} className={secondaryBtn}>
              Back
            </button>
            <button
              disabled={!canProceedStep2}
              onClick={() => setStep(3)}
              className={primaryBtn}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Secrets */}
      {step === 3 && (
        <div className="max-w-lg mx-auto space-y-4">
          <p className="text-sm text-hub-text-secondary">
            API keys or secrets the tools need at execution time. Stored encrypted and
            injected only when your agent runs a tool — they are <strong>never</strong> exposed
            to renters (ADR-024 privacy contract). This step is optional.
          </p>

          {secrets.map((secret, i) => (
            <div key={i} className="flex gap-3 items-end">
              <div className="flex-1">
                <label className={labelClass}>Key Name</label>
                <input
                  type="text"
                  value={secret.key}
                  onChange={(e) => updateSecret(i, { key: e.target.value })}
                  placeholder="OPENAI_API_KEY"
                  className={inputClass}
                />
              </div>
              <div className="flex-1">
                <label className={labelClass}>Value</label>
                <input
                  type="password"
                  value={secret.value}
                  onChange={(e) => updateSecret(i, { value: e.target.value })}
                  placeholder="sk-..."
                  className={inputClass}
                />
              </div>
              <button
                onClick={() => removeSecret(i)}
                className="text-xs text-red-400 hover:text-red-300 transition-colors pb-2"
              >
                Remove
              </button>
            </div>
          ))}

          <button onClick={addSecret} className={secondaryBtn}>
            + Add Secret
          </button>

          <div className="flex justify-between pt-2">
            <button onClick={() => setStep(2)} className={secondaryBtn}>
              Back
            </button>
            <button onClick={() => setStep(4)} className={primaryBtn}>
              Next
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Review */}
      {step === 4 && (
        <div className="max-w-lg mx-auto space-y-6">
          {/* Agent name */}
          <div className="bg-white/[0.02] border border-hub-border rounded-lg p-4">
            <h3 className="text-sm font-medium text-hub-text-secondary mb-2">Agent</h3>
            <p className="text-hub-text-primary font-semibold">{name}</p>
            {description && (
              <p className="text-hub-text-tertiary text-sm mt-1">{description}</p>
            )}
          </div>

          {/* Tools summary */}
          <div className="bg-white/[0.02] border border-hub-border rounded-lg p-4">
            <h3 className="text-sm font-medium text-hub-text-secondary mb-2">
              Tools ({skills.length})
            </h3>
            <div className="space-y-2">
              {skills.map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="text-hub-text-primary">{s.skill_id}</span>
                  <span className="text-hub-text-tertiary">-</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    s.mode === 'direct_api'
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : s.mode === 'relay'
                        ? 'bg-blue-500/15 text-blue-400'
                        : 'bg-amber-500/15 text-amber-400'
                  }`}>
                    {s.mode === 'direct_api' ? 'API' : s.mode === 'relay' ? 'Relay' : 'Queue'}
                  </span>
                  {s.mode === 'direct_api' && (
                    <span className="text-hub-text-tertiary text-xs">{s.method} {s.endpoint}</span>
                  )}
                  {(s.mode === 'relay' || s.mode === 'queue') && (
                    <span className="text-hub-text-tertiary text-xs">via @{s.relay_owner}</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Secrets summary */}
          {secrets.length > 0 && (
            <div className="bg-white/[0.02] border border-hub-border rounded-lg p-4">
              <h3 className="text-sm font-medium text-hub-text-secondary mb-2">
                Secrets ({secrets.filter((s) => s.key.trim()).length})
              </h3>
              <div className="space-y-1">
                {secrets.filter((s) => s.key.trim()).map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="text-hub-text-primary font-mono">{s.key}</span>
                    <span className="text-hub-text-tertiary">= ********</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {submitError && (
            <div className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3">
              <p className="text-sm text-red-400">{submitError}</p>
            </div>
          )}

          <div className="flex justify-between pt-2">
            <button onClick={() => setStep(3)} className={secondaryBtn}>
              Back
            </button>
            <button
              disabled={submitting}
              onClick={() => void handleSubmit()}
              className={primaryBtn}
            >
              {submitting ? 'Creating...' : 'Make my agent rentable'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
