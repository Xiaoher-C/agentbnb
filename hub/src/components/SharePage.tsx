/**
 * SharePage — The "Publish Agent" page (v10 Agent Maturity Rental).
 *
 * Lives at `/share`. Helps an operator turn their locally-running, matured
 * agent into a rentable Agent Profile. The underlying POST /cards API and
 * draft schema are unchanged (CapabilityCard remains the substrate); only
 * the user-facing copy has been reframed for v10.
 *
 * On mount, probes /health with a 2s timeout to detect whether the local
 * AgentBnB server is running.
 *
 * - Server unreachable: shows "Local agent runtime not detected" block.
 * - Server running + apiKey: fetches GET /draft (auth-protected) and displays each
 *   draft as an editable Agent Profile preview (name, description,
 *   per-session credits pre-populated). "Make my agent rentable" button
 *   sends POST /cards with the edited payload.
 * - Server running + no draft cards: shows guidance to set API keys.
 * - Server running + no apiKey: shows read-only mode with login prompt.
 */
import { useState, useEffect, useCallback } from 'react';
import type { HubCard } from '../types.js';
import { Skeleton } from './Skeleton.js';
import { authedFetch, canonicalizeAgentId, loadSession } from '../lib/authHeaders.js';

export interface SharePageProps {
  /** Current API key from useAuth(). null when not authenticated. */
  apiKey: string | null;
}

interface DraftCardForm {
  id: string;
  name: string;
  description: string;
  credits_per_call: number;
  original: HubCard;
}

type ServerStatus = 'checking' | 'running' | 'unreachable';

const COMMAND = 'agentbnb serve';

/**
 * Renders the Share page — draft card preview and publish workflow.
 */
export default function SharePage({ apiKey }: SharePageProps): JSX.Element {
  const [serverStatus, setServerStatus] = useState<ServerStatus>('checking');
  const [draftForms, setDraftForms] = useState<DraftCardForm[]>([]);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [publishStatus, setPublishStatus] = useState<Record<string, 'idle' | 'publishing' | 'done' | 'error'>>({});

  // Probe /health with 2s timeout on mount
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);

    fetch('/health', { signal: controller.signal })
      .then((res) => {
        clearTimeout(timer);
        if (res.ok) {
          setServerStatus('running');
        } else {
          setServerStatus('unreachable');
        }
      })
      .catch(() => {
        clearTimeout(timer);
        setServerStatus('unreachable');
      });

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, []);

  // Fetch /draft when server is running and apiKey is present
  const fetchDraft = useCallback(async () => {
    if (!apiKey) return;
    setDraftLoading(true);
    setDraftError(null);

    try {
      const isDid = apiKey === '__did__';
      const res = isDid
        ? await authedFetch('/draft')
        : await fetch('/draft', {
            headers: { Authorization: `Bearer ${apiKey}` },
          });

      if (!res.ok) {
        throw new Error(`/draft returned ${res.status}`);
      }

      const data = await res.json() as { cards: HubCard[] };
      setDraftForms(
        data.cards.map((card) => ({
          id: card.id,
          name: card.name,
          description: card.description,
          credits_per_call: card.pricing.credits_per_call,
          original: card,
        })),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setDraftError(msg);
    } finally {
      setDraftLoading(false);
    }
  }, [apiKey]);

  useEffect(() => {
    if (serverStatus === 'running' && apiKey) {
      void fetchDraft();
    }
  }, [serverStatus, apiKey, fetchDraft]);

  /** Publishes a single draft card via POST /cards. */
  const handlePublish = async (form: DraftCardForm): Promise<void> => {
    setPublishStatus((prev) => ({ ...prev, [form.id]: 'publishing' }));

    try {
      const isDid = apiKey === '__did__';
      // /draft built the card with the server's ownerName. In DID mode the
      // backend now requires card.owner === authenticated agent_id, so rewrite
      // it before POSTing.
      const session = isDid ? loadSession() : null;
      const owner = session ? canonicalizeAgentId(session.agentId) : form.original.owner;
      const cardPayload: Omit<HubCard, 'id'> = {
        ...form.original,
        owner,
        name: form.name,
        description: form.description,
        pricing: { ...form.original.pricing, credits_per_call: form.credits_per_call },
      };

      const res = isDid
        ? await authedFetch('/cards', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(cardPayload),
          })
        : await fetch('/cards', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey ?? ''}`,
            },
            body: JSON.stringify(cardPayload),
          });

      if (!res.ok) throw new Error(`POST /cards returned ${res.status}`);

      setPublishStatus((prev) => ({ ...prev, [form.id]: 'done' }));
    } catch {
      setPublishStatus((prev) => ({ ...prev, [form.id]: 'error' }));
    }
  };

  /** Updates a draft form field value. */
  const updateForm = (id: string, field: keyof Omit<DraftCardForm, 'id' | 'original'>, value: string | number): void => {
    setDraftForms((prev) =>
      prev.map((f) => (f.id === id ? { ...f, [field]: value } : f)),
    );
  };

  // --- Render states ---

  if (serverStatus === 'checking') {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400 text-sm">
        Checking server status…
      </div>
    );
  }

  if (serverStatus === 'unreachable') {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 px-6 py-8 space-y-4">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-500 shrink-0" />
          <h3 className="text-base font-semibold text-slate-200">Local agent runtime not detected</h3>
        </div>
        <p className="text-sm text-slate-400">
          Your agent runs on your machine — that&apos;s what keeps the privacy contract intact.
          Start the local AgentBnB runtime to publish a rentable Agent Profile.
        </p>
        <div className="rounded-md bg-slate-900 px-4 py-3 font-mono text-sm text-emerald-400 select-all">
          agentbnb serve
        </div>
        <p className="text-xs text-slate-500">
          Run <code className="text-slate-400">agentbnb serve</code> in your terminal, then refresh this page.
        </p>
      </div>
    );
  }

  // Server is running
  if (!apiKey) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 px-6 py-8 text-center space-y-3">
        <div className="flex items-center justify-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          <p className="text-sm font-medium text-slate-300">Local agent runtime detected</p>
        </div>
        <p className="text-sm text-slate-400">
          Sign in as the operator to publish a rentable Agent Profile.
        </p>
      </div>
    );
  }

  if (draftLoading) {
    return (
      <div className="space-y-4 py-8">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (draftError) {
    return (
      <div className="rounded-lg border border-red-800 bg-red-900/20 px-6 py-8 text-center">
        <p className="text-sm text-red-400">{draftError}</p>
        <button
          onClick={() => { void fetchDraft(); }}
          className="mt-3 text-xs text-slate-400 hover:text-slate-300 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (draftForms.length === 0) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 px-6 py-8 space-y-4">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          <p className="text-sm font-medium text-slate-300">Local agent runtime detected</p>
        </div>
        <h3 className="text-base font-semibold text-slate-200">No draft cards detected</h3>
        <p className="text-sm text-slate-400">
          AgentBnB looks for API keys in your environment to auto-generate a draft Agent Profile.
          Set at least one key (e.g. <code className="text-emerald-400">OPENAI_API_KEY</code>) and restart the runtime.
        </p>
        <div className="rounded-md bg-slate-900 px-4 py-3 font-mono text-sm text-slate-400">
          OPENAI_API_KEY=sk-... {COMMAND}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* v10 framing header */}
      <header className="space-y-2">
        <h2 className="text-xl font-semibold text-slate-100">Publish your rentable agent</h2>
        <p className="text-sm text-slate-400 max-w-2xl">
          Turn the agent you&apos;ve been tuning into an Agent Profile that other operators
          can rent for a 60-minute session. Pricing below is per-session, not per-call.
        </p>
      </header>

      {/* Privacy contract callout (ADR-024) */}
      <aside
        aria-labelledby="privacy-contract-heading"
        className="rounded-lg border border-emerald-700/40 bg-emerald-950/20 px-4 py-3 space-y-1.5"
      >
        <p
          id="privacy-contract-heading"
          className="text-xs font-semibold uppercase tracking-wide text-emerald-300"
        >
          Privacy contract — 租用執行能力，不租用 agent 的腦與鑰匙
        </p>
        <ul className="text-xs text-slate-300/90 space-y-1 list-disc pl-5">
          <li>Tools execute on your machine. Renters only see results.</li>
          <li>Each rental session is isolated — conversations never pollute your main agent memory.</li>
          <li>
            Curate the persona &amp; tool whitelist via a{' '}
            <code className="text-emerald-400">RENTAL.md</code> file —{' '}
            <a
              href="https://github.com/Xiaoher-C/agentbnb/blob/main/hermes-plugin/examples/RENTAL.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-300 underline hover:text-emerald-200"
            >
              see the example
            </a>
            .
          </li>
        </ul>
      </aside>

      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
        <p className="text-sm text-slate-400">
          Local agent runtime detected — {draftForms.length} draft Agent Profile
          {draftForms.length !== 1 ? 's' : ''} ready to publish
        </p>
      </div>

      {draftForms.map((form) => {
        const status = publishStatus[form.id] ?? 'idle';

        return (
          <div key={form.id} className="rounded-lg border border-slate-700 bg-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">Draft Agent Profile</h3>
              {status === 'done' && (
                <span className="text-xs font-medium text-emerald-400">Live — agent is now rentable</span>
              )}
              {status === 'error' && (
                <span className="text-xs font-medium text-red-400">Publish failed — try again</span>
              )}
            </div>

            {/* Editable fields */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Agent name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => { updateForm(form.id, 'name', e.target.value); }}
                  className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  What this agent is good at (renters read this first)
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) => { updateForm(form.id, 'description', e.target.value); }}
                  rows={3}
                  className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none resize-none"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Credits per 60-min session</label>
                <input
                  type="number"
                  min={0}
                  value={form.credits_per_call}
                  onChange={(e) => { updateForm(form.id, 'credits_per_call', Number(e.target.value)); }}
                  className="w-32 rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Price per rental session, not per call. Sessions default to 60 minutes.
                </p>
              </div>
            </div>

            <button
              onClick={() => { void handlePublish(form); }}
              disabled={status === 'publishing' || status === 'done'}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {status === 'publishing'
                ? 'Publishing…'
                : status === 'done'
                  ? 'Live — rentable'
                  : 'Make my agent rentable'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
