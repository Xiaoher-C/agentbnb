/**
 * ThreadList — Right-rail list of task threads inside a rental session.
 *
 * Threads are independent deliverable units inside a session — they let the
 * outcome page summarize "what got done" without dumping the entire chat
 * transcript. Each thread renders title + status + a "Mark complete" action.
 *
 * Mutations call:
 *   POST /api/sessions/:id/threads               (create)
 *   POST /api/sessions/:id/threads/:tid/complete (complete)
 *
 * The component is intentionally dumb about persistence: parents pass `threads`
 * + the create/complete callbacks. The SessionRoom owns the optimistic refetch.
 */
import { useState, type FormEvent } from 'react';
import { CheckCircle2, Circle, Plus } from 'lucide-react';

interface ThreadListItem {
  id: string;
  title: string;
  description: string;
  status: 'in_progress' | 'completed';
  created_at: string;
  completed_at: string | null;
}

interface ThreadListProps {
  threads: ThreadListItem[];
  /** Called when the renter creates a new thread. */
  onCreate: (input: { title: string; description: string }) => Promise<void> | void;
  /** Called when either party marks a thread complete. */
  onComplete: (threadId: string) => Promise<void> | void;
  /** When true, hides the create form and complete buttons (e.g. session ended). */
  readOnly?: boolean;
}

/** Format an ISO timestamp into a short locale string. */
function fmtDate(iso: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

/**
 * Right-rail thread list with create + complete affordances.
 */
export default function ThreadList({
  threads,
  onCreate,
  onComplete,
  readOnly = false,
}: ThreadListProps): JSX.Element {
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate({ title: title.trim(), description: description.trim() });
      setTitle('');
      setDescription('');
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create thread');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <aside className="rounded-card border border-hub-border-default bg-hub-surface-0 p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-hub-text-muted">
          Threads ({threads.length})
        </h3>
        {!readOnly && !showForm ? (
          <button
            type="button"
            onClick={() => { setShowForm(true); }}
            className="inline-flex items-center gap-1 rounded-md border border-hub-border-default px-2 py-1 text-[11px] text-hub-text-secondary hover:bg-white/[0.06] hover:text-hub-text-primary transition"
          >
            <Plus size={11} aria-hidden="true" />
            New
          </button>
        ) : null}
      </div>

      {showForm && !readOnly ? (
        <form
          onSubmit={(e) => { void handleCreate(e); }}
          className="mb-3 space-y-2 rounded-md border border-hub-border-default bg-white/[0.02] p-2"
        >
          <input
            type="text"
            value={title}
            onChange={(e) => { setTitle(e.target.value); }}
            placeholder="Thread title"
            disabled={submitting}
            className="w-full rounded border border-hub-border-default bg-hub-bg px-2 py-1 text-xs text-hub-text-primary placeholder:text-hub-text-muted focus:border-hub-accent focus:outline-none"
          />
          <textarea
            value={description}
            onChange={(e) => { setDescription(e.target.value); }}
            placeholder="Optional description"
            rows={2}
            disabled={submitting}
            className="w-full resize-none rounded border border-hub-border-default bg-hub-bg px-2 py-1 text-xs text-hub-text-primary placeholder:text-hub-text-muted focus:border-hub-accent focus:outline-none"
          />
          {error ? <p className="text-[11px] text-rose-400">{error}</p> : null}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => { setShowForm(false); setError(null); }}
              disabled={submitting}
              className="text-[11px] text-hub-text-muted hover:text-hub-text-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !title.trim()}
              className="rounded bg-hub-accent px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      ) : null}

      {threads.length === 0 ? (
        <p className="text-xs text-hub-text-muted">
          No threads yet. Open one for each deliverable so the outcome page can summarize them.
        </p>
      ) : (
        <ul className="space-y-2">
          {threads.map((t) => {
            const isDone = t.status === 'completed';
            return (
              <li
                key={t.id}
                className={`rounded-md border px-2 py-2 ${
                  isDone
                    ? 'border-hub-border-default bg-white/[0.02]'
                    : 'border-emerald-500/20 bg-emerald-500/[0.04]'
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className="pt-0.5 shrink-0">
                    {isDone ? (
                      <CheckCircle2 size={14} className="text-hub-accent" aria-hidden="true" />
                    ) : (
                      <Circle size={14} className="text-hub-text-muted" aria-hidden="true" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-xs font-medium ${isDone ? 'text-hub-text-secondary line-through' : 'text-hub-text-primary'}`}>
                      {t.title}
                    </p>
                    {t.description ? (
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-hub-text-muted">
                        {t.description}
                      </p>
                    ) : null}
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-hub-text-muted">
                      <span>Opened {fmtDate(t.created_at)}</span>
                      {isDone && t.completed_at ? <span>· Done {fmtDate(t.completed_at)}</span> : null}
                    </div>
                  </div>
                </div>
                {!isDone && !readOnly ? (
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => { void onComplete(t.id); }}
                      className="text-[11px] text-hub-accent hover:underline"
                    >
                      Mark complete
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
