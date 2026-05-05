/**
 * MessageComposer — Bottom-of-room input for sending messages and uploading
 * files into a v10 rental session.
 *
 * Renders a textarea + send button + drag/drop file zone. Pressing
 * Cmd/Ctrl+Enter sends. Files are POSTed to
 * `/api/sessions/:id/files` (endpoint added in unit B0). If that endpoint is
 * not yet deployed, the upload silently surfaces an error message and the
 * text-only path remains fully functional.
 *
 * The composer never persists draft text to localStorage — drafts live in
 * component state only, mirroring the privacy contract of the room itself.
 */
import { useCallback, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent } from 'react';
import { Paperclip, Send } from 'lucide-react';
import { authedFetch } from '../lib/authHeaders.js';

interface MessageComposerProps {
  /** Session id — used to scope the file upload endpoint. */
  sessionId: string;
  /** Send the typed text. */
  onSend: (content: string) => void;
  /** Optional: invoked after a successful file upload, with the metadata returned by the server. */
  onFileUploaded?: (file: { id: string; filename: string; size_bytes: number }) => void;
  /** Disabled when the session is closed or the socket isn't open yet. */
  disabled?: boolean;
  /** When true, the next message is flagged as a human intervention. */
  isHumanInterventionMode?: boolean;
  /** Placeholder copy override. */
  placeholder?: string;
}

/**
 * Bottom-of-room composer with drag/drop file upload.
 *
 * Behaviour:
 *   - Enter inserts a newline; Cmd/Ctrl+Enter submits.
 *   - Drag/drop OR clicking the paperclip uploads to
 *     `POST /api/sessions/:id/files`.
 *   - When `disabled` is true, the textarea + buttons are inert and a hint is shown.
 */
export default function MessageComposer({
  sessionId,
  onSend,
  onFileUploaded,
  disabled = false,
  isHumanInterventionMode = false,
  placeholder,
}: MessageComposerProps): JSX.Element {
  const [draft, setDraft] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSend = draft.trim().length > 0 && !disabled;

  const submit = useCallback((e?: FormEvent | KeyboardEvent): void => {
    if (e) e.preventDefault();
    if (!canSend) return;
    onSend(draft);
    setDraft('');
  }, [canSend, draft, onSend]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      submit(e);
    }
  }, [submit]);

  const uploadFiles = useCallback(async (files: FileList | File[]): Promise<void> => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploadError(null);
    setUploadingCount(prev => prev + list.length);

    for (const file of list) {
      try {
        const form = new FormData();
        form.append('file', file);
        const res = await authedFetch(`/api/sessions/${encodeURIComponent(sessionId)}/files`, {
          method: 'POST',
          body: form,
        });
        if (!res.ok) {
          // Endpoint may not exist yet (unit B0 lands separately).
          const text = await res.text().catch(() => '');
          throw new Error(text || `Upload failed (${res.status})`);
        }
        const data = await res.json() as { id?: string; filename?: string; size_bytes?: number };
        if (data.id && data.filename && typeof data.size_bytes === 'number') {
          onFileUploaded?.({ id: data.id, filename: data.filename, size_bytes: data.size_bytes });
        }
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setUploadingCount(prev => Math.max(0, prev - 1));
      }
    }
  }, [sessionId, onFileUploaded]);

  const handleDrop = useCallback((e: DragEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void uploadFiles(e.dataTransfer.files);
    }
  }, [disabled, uploadFiles]);

  const handleDragOver = useCallback((e: DragEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (disabled) return;
    setIsDragging(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e: DragEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  return (
    <form
      onSubmit={submit}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={`relative rounded-card border bg-hub-surface-0 transition-colors ${
        isDragging
          ? 'border-hub-accent ring-1 ring-hub-accent/40'
          : isHumanInterventionMode
            ? 'border-amber-500/40'
            : 'border-hub-border-default'
      }`}
    >
      <textarea
        value={draft}
        onChange={e => { setDraft(e.target.value); }}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        rows={3}
        placeholder={
          placeholder ??
          (disabled
            ? 'Session is not open.'
            : isHumanInterventionMode
              ? '直接和出租 agent 對話 — Type your message (Cmd/Ctrl+Enter to send)'
              : '透過我的 agent — Type your message (Cmd/Ctrl+Enter to send)')
        }
        className="w-full resize-none rounded-card bg-transparent px-3 pt-3 pb-12 text-sm text-hub-text-primary placeholder:text-hub-text-muted focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      />

      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="inline-flex items-center gap-1.5 rounded-md border border-hub-border-default bg-white/[0.02] px-2.5 py-1.5 text-xs text-hub-text-secondary hover:bg-white/[0.06] hover:text-hub-text-primary transition disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Attach file"
          >
            <Paperclip size={12} aria-hidden="true" />
            Attach
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={e => {
              if (e.target.files) {
                void uploadFiles(e.target.files);
                e.target.value = '';
              }
            }}
          />
          {uploadingCount > 0 ? (
            <span className="text-xs text-hub-text-muted">
              Uploading {uploadingCount}…
            </span>
          ) : null}
          {uploadError ? (
            <span className="text-xs text-amber-400">{uploadError}</span>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={!canSend}
          className="inline-flex items-center gap-1.5 rounded-md bg-hub-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 transition disabled:bg-white/[0.06] disabled:text-hub-text-muted disabled:cursor-not-allowed"
        >
          <Send size={12} aria-hidden="true" />
          Send
        </button>
      </div>

      {isDragging ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-card bg-hub-accent/10 text-sm font-medium text-hub-accent">
          Drop to attach
        </div>
      ) : null}
    </form>
  );
}
