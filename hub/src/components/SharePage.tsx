/**
 * SharePage — The "Share" tab page.
 *
 * On mount, probes /health with a 2s timeout to detect whether the local
 * AgentBnB server is running.
 *
 * - Server unreachable: shows "Server Not Running" block with agentbnb serve command.
 * - Server running + apiKey: fetches GET /draft (auth-protected) and displays each
 *   draft card as an editable form (name, description, credits_per_call pre-populated).
 *   "Publish" button sends POST /cards with the edited card data.
 * - Server running + no draft cards: shows guidance to set API keys.
 * - Server running + no apiKey: shows cards in read-only mode with login prompt.
 */
import { useState, useEffect, useCallback } from 'react';
import type { HubCard } from '../types.js';

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
      const res = await fetch('/draft', {
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
      const cardPayload: Omit<HubCard, 'id'> = {
        ...form.original,
        name: form.name,
        description: form.description,
        pricing: { ...form.original.pricing, credits_per_call: form.credits_per_call },
      };

      const res = await fetch('/cards', {
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
          <h3 className="text-base font-semibold text-slate-200">Server Not Running</h3>
        </div>
        <p className="text-sm text-slate-400">
          Start the local AgentBnB server to publish capabilities and share your agent.
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
          <p className="text-sm font-medium text-slate-300">Server Running</p>
        </div>
        <p className="text-sm text-slate-400">
          Log in via the <strong className="text-slate-300">My Agent</strong> tab to publish your capabilities.
        </p>
      </div>
    );
  }

  if (draftLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400 text-sm">
        Loading draft cards…
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
          <p className="text-sm font-medium text-slate-300">Server Running</p>
        </div>
        <h3 className="text-base font-semibold text-slate-200">No draft cards detected</h3>
        <p className="text-sm text-slate-400">
          AgentBnB looks for API keys in your environment to auto-generate draft Capability Cards.
          Set at least one key (e.g. <code className="text-emerald-400">OPENAI_API_KEY</code>) and restart the server.
        </p>
        <div className="rounded-md bg-slate-900 px-4 py-3 font-mono text-sm text-slate-400">
          OPENAI_API_KEY=sk-... {COMMAND}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
        <p className="text-sm text-slate-400">Server Running — {draftForms.length} draft card{draftForms.length !== 1 ? 's' : ''} ready to publish</p>
      </div>

      {draftForms.map((form) => {
        const status = publishStatus[form.id] ?? 'idle';

        return (
          <div key={form.id} className="rounded-lg border border-slate-700 bg-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">Draft Card</h3>
              {status === 'done' && (
                <span className="text-xs font-medium text-emerald-400">Published</span>
              )}
              {status === 'error' && (
                <span className="text-xs font-medium text-red-400">Publish failed — try again</span>
              )}
            </div>

            {/* Editable fields */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => { updateForm(form.id, 'name', e.target.value); }}
                  className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => { updateForm(form.id, 'description', e.target.value); }}
                  rows={3}
                  className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none resize-none"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Credits per call</label>
                <input
                  type="number"
                  min={0}
                  value={form.credits_per_call}
                  onChange={(e) => { updateForm(form.id, 'credits_per_call', Number(e.target.value)); }}
                  className="w-32 rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            <button
              onClick={() => { void handlePublish(form); }}
              disabled={status === 'publishing' || status === 'done'}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {status === 'publishing' ? 'Publishing…' : status === 'done' ? 'Published' : 'Publish'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
