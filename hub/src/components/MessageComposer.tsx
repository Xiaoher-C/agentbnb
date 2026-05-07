/**
 * MessageComposer — Bottom-of-room input for sending messages and uploading
 * files into a v10 rental session.
 *
 * Renders a textarea + send button + drag/drop file zone + per-upload chips.
 * Pressing Cmd/Ctrl+Enter sends. Files are POSTed to
 * `/api/sessions/:id/files` (B0). The server returns a `FileRef` on 201,
 * 413 when the file exceeds 10 MB, and 403 when the caller is not a session
 * participant. Each upload is tracked individually so concurrent uploads
 * are first-class — see `uploads` state below.
 *
 * Successful uploads add a chip to the pending-attachments list. The user
 * can remove any pending chip before sending. When the message is sent,
 * the chip ids are forwarded to `onSend(content, attachments)` and the
 * pending list is cleared.
 *
 * The composer never persists draft text or attachment state to
 * localStorage — both live in component state only, mirroring the privacy
 * contract of the room itself (ADR-024).
 */
import {
  useCallback,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Paperclip, Send, X } from 'lucide-react';

/** Minimal subset of the server-returned `FileRef` consumed by the room. */
export interface ComposerAttachment {
  id: string;
  filename: string;
  size_bytes: number;
  mime_type?: string;
}

/**
 * Per-file upload tracking — one entry per pick/drop, regardless of outcome.
 * Status drives the chip rendering: progress bar while `uploading`, error
 * label + retry hint when `error`, file pill when `done`.
 */
interface UploadEntry {
  /** Stable client id, used as React key + as the cancel target. */
  localId: string;
  /** The original filename (before server sanitization). */
  filename: string;
  /** Original byte size for the inline progress bar. */
  size_bytes: number;
  /** 0..1 — driven by xhr.upload.progress while in flight. */
  progress: number;
  /** Lifecycle. */
  status: 'uploading' | 'done' | 'error' | 'cancelled';
  /** Populated when status === 'done'. */
  result?: ComposerAttachment;
  /** Populated when status === 'error'. */
  error?: string;
  /** Used to cancel the in-flight request; cleared on completion. */
  xhr?: XMLHttpRequest;
}

interface MessageComposerProps {
  /** Session id — used to scope the file upload endpoint. */
  sessionId: string;
  /**
   * Renter DID — sent as the `x-agent-did` header on file uploads so the
   * server can run the participant check (see `requireParticipant` in
   * `src/registry/session-routes.ts`). When omitted the upload still runs
   * but will receive a 401 from the server.
   */
  callerDid?: string;
  /** Send the typed text plus any pending attachments (cleared on success). */
  onSend: (content: string, attachments: ComposerAttachment[]) => void;
  /** Optional: invoked after a successful file upload, with the metadata returned by the server. */
  onFileUploaded?: (file: ComposerAttachment) => void;
  /** Disabled when the session is closed or the socket isn't open yet. */
  disabled?: boolean;
  /** When true, the next message is flagged as a human intervention. */
  isHumanInterventionMode?: boolean;
  /** Placeholder copy override. */
  placeholder?: string;
}

/** Maximum file size enforced client-side. Mirrors `MAX_FILE_BYTES` on the server. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Generate a non-cryptographic stable id for one local upload. */
function genLocalId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Pretty bytes (KB/MB) for the chip subtitle. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Map an HTTP status to user-friendly copy. */
function describeUploadError(status: number, fallback: string): string {
  if (status === 413) return 'File too large (max 10 MB)';
  if (status === 403) return "You're not a participant of this session";
  if (status === 401) return 'Sign in again to upload files';
  return fallback || `Upload failed (${status})`;
}

/**
 * Bottom-of-room composer with drag/drop file upload + pending-attachment chips.
 */
export default function MessageComposer({
  sessionId,
  callerDid,
  onSend,
  onFileUploaded,
  disabled = false,
  isHumanInterventionMode = false,
  placeholder,
}: MessageComposerProps): JSX.Element {
  const [draft, setDraft] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Patch a single upload entry by localId. */
  const updateUpload = useCallback((localId: string, patch: Partial<UploadEntry>): void => {
    setUploads(prev => prev.map(u => (u.localId === localId ? { ...u, ...patch } : u)));
  }, []);

  /** Drop one entry from the list (used by remove + dismiss-error). */
  const removeUpload = useCallback((localId: string): void => {
    setUploads(prev => {
      const target = prev.find(u => u.localId === localId);
      if (target?.xhr && target.status === 'uploading') {
        try { target.xhr.abort(); } catch { /* ignore */ }
      }
      return prev.filter(u => u.localId !== localId);
    });
  }, []);

  const pendingAttachments: ComposerAttachment[] = uploads
    .filter((u): u is UploadEntry & { result: ComposerAttachment } => u.status === 'done' && !!u.result)
    .map(u => u.result);

  const canSend =
    !disabled &&
    (draft.trim().length > 0 || pendingAttachments.length > 0) &&
    !uploads.some(u => u.status === 'uploading');

  const submit = useCallback((e?: FormEvent | KeyboardEvent): void => {
    if (e) e.preventDefault();
    if (!canSend) return;
    onSend(draft, pendingAttachments);
    setDraft('');
    // Clear only the successfully-attached chips; preserve any error chips so
    // the user sees what failed and can retry or dismiss.
    setUploads(prev => prev.filter(u => u.status !== 'done'));
  }, [canSend, draft, onSend, pendingAttachments]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      submit(e);
    }
  }, [submit]);

  /**
   * Upload a single file via XHR so we can drive progress + cancel.
   *
   * The v10 session-routes file endpoint reads `x-agent-did` directly
   * (see ADR-024 / session-routes), so we forward `callerDid` as that
   * header rather than going through the Ed25519 `authedFetch` flow.
   */
  const startUpload = useCallback((file: File): void => {
    const localId = genLocalId();

    // Pre-flight size check — saves a round trip and matches the server cap.
    if (file.size > MAX_FILE_BYTES) {
      setUploads(prev => [
        ...prev,
        {
          localId,
          filename: file.name,
          size_bytes: file.size,
          progress: 0,
          status: 'error',
          error: 'File too large (max 10 MB)',
        },
      ]);
      return;
    }

    const xhr = new XMLHttpRequest();
    setUploads(prev => [
      ...prev,
      {
        localId,
        filename: file.name,
        size_bytes: file.size,
        progress: 0,
        status: 'uploading',
        xhr,
      },
    ]);

    xhr.open('POST', `/api/sessions/${encodeURIComponent(sessionId)}/files`, true);
    if (callerDid) {
      xhr.setRequestHeader('x-agent-did', callerDid);
    }

    xhr.upload.onprogress = (ev: ProgressEvent): void => {
      if (!ev.lengthComputable) return;
      updateUpload(localId, { progress: ev.loaded / ev.total });
    };

    xhr.onload = (): void => {
      // 2xx — parse FileRef and add to pending attachments.
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as Partial<ComposerAttachment>;
          if (data.id && data.filename && typeof data.size_bytes === 'number') {
            const result: ComposerAttachment = {
              id: data.id,
              filename: data.filename,
              size_bytes: data.size_bytes,
              mime_type: data.mime_type,
            };
            updateUpload(localId, { status: 'done', progress: 1, result, xhr: undefined });
            onFileUploaded?.(result);
            return;
          }
        } catch {
          /* fall through to error handling */
        }
        updateUpload(localId, {
          status: 'error',
          error: 'Server returned an unexpected response',
          xhr: undefined,
        });
        return;
      }

      // Non-2xx — derive a friendly error from the status + body.
      let body = '';
      try {
        const parsed = JSON.parse(xhr.responseText) as { error?: unknown };
        if (typeof parsed.error === 'string') body = parsed.error;
      } catch {
        body = xhr.responseText;
      }
      updateUpload(localId, {
        status: 'error',
        error: describeUploadError(xhr.status, body),
        xhr: undefined,
      });
    };

    xhr.onerror = (): void => {
      updateUpload(localId, {
        status: 'error',
        error: 'Network error — please retry',
        xhr: undefined,
      });
    };

    xhr.onabort = (): void => {
      updateUpload(localId, { status: 'cancelled', xhr: undefined });
    };

    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  }, [sessionId, callerDid, onFileUploaded, updateUpload]);

  const uploadFiles = useCallback((files: FileList | File[]): void => {
    const list = Array.from(files);
    for (const file of list) {
      startUpload(file);
    }
  }, [startUpload]);

  const handleDrop = useCallback((e: DragEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
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

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const showChipRow = uploads.length > 0;

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
      {showChipRow ? (
        <ul
          className="flex flex-wrap gap-1.5 border-b border-hub-border-default/60 px-2 pt-2 pb-1.5"
          aria-label="Pending attachments"
        >
          {uploads.map(u => (
            <UploadChip
              key={u.localId}
              upload={u}
              onRemove={() => { removeUpload(u.localId); }}
            />
          ))}
        </ul>
      ) : null}

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
                uploadFiles(e.target.files);
                e.target.value = '';
              }
            }}
          />
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

// ---------------------------------------------------------------------------
// Chip — extracted because the per-upload markup carries enough state to
// justify isolating its render and aria semantics.
// ---------------------------------------------------------------------------

interface UploadChipProps {
  upload: UploadEntry;
  onRemove: () => void;
}

function UploadChip({ upload, onRemove }: UploadChipProps): JSX.Element {
  const isError = upload.status === 'error';
  const isCancelled = upload.status === 'cancelled';
  const isUploading = upload.status === 'uploading';
  const isDone = upload.status === 'done';

  const tone = isError
    ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
    : isCancelled
      ? 'border-hub-border-default bg-white/[0.02] text-hub-text-muted'
      : isDone
        ? 'border-hub-border-default bg-white/[0.04] text-hub-text-secondary'
        : 'border-hub-border-default bg-white/[0.03] text-hub-text-secondary';

  const labelId = `upload-${upload.localId}-label`;

  return (
    <li
      className={`group relative flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${tone}`}
      aria-labelledby={labelId}
    >
      <Paperclip size={11} aria-hidden="true" className="shrink-0 opacity-70" />
      <div className="min-w-0 max-w-[16rem]">
        <span id={labelId} className="block truncate font-medium">
          {upload.filename}
        </span>
        <span className="block text-[10px] text-hub-text-muted">
          {isUploading
            ? `Uploading… ${Math.round(upload.progress * 100)}%`
            : isError
              ? upload.error ?? 'Upload failed'
              : isCancelled
                ? 'Cancelled'
                : formatBytes(upload.size_bytes)}
        </span>
        {isUploading ? (
          <div
            className="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-white/[0.06]"
            role="progressbar"
            aria-valuenow={Math.round(upload.progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Uploading ${upload.filename}`}
          >
            <div
              className="h-full bg-hub-accent transition-[width] duration-150"
              style={{ width: `${Math.round(upload.progress * 100)}%` }}
            />
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-hub-text-muted hover:bg-white/[0.06] hover:text-hub-text-primary"
        aria-label={isUploading ? `Cancel upload of ${upload.filename}` : `Remove ${upload.filename}`}
      >
        <X size={10} aria-hidden="true" />
      </button>
    </li>
  );
}
