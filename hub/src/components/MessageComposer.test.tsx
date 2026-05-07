/**
 * MessageComposer tests.
 *
 * Covers the upload state machine added in v10 unit E1:
 *   - paperclip pick triggers POST /api/sessions/:id/files
 *   - 201 response surfaces a chip + populates pending attachments
 *   - 413 / 403 responses surface friendly inline copy
 *   - removable chips before send
 *   - attachments forwarded to onSend()
 *
 * The composer drives uploads through XMLHttpRequest so we can show progress
 * + cancel; the test stubs XHR globally and resolves uploads synchronously.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import MessageComposer, { type ComposerAttachment } from './MessageComposer.js';

// ---------------------------------------------------------------------------
// XMLHttpRequest stub — supports a tiny scripted-response surface so each
// test can decide what status / body the server "returns".
// ---------------------------------------------------------------------------

interface ScriptedResponse {
  status: number;
  body: unknown;
  /** Optional cap so tests can assert progress events fire. */
  fireProgress?: boolean;
}

let nextResponse: ScriptedResponse = { status: 201, body: null };
let lastSentForm: FormData | null = null;
let lastUrl = '';
let lastHeaders: Record<string, string> = {};

class FakeXHR {
  readonly upload = {
    onprogress: null as ((ev: ProgressEvent) => void) | null,
  };
  status = 0;
  responseText = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private headers: Record<string, string> = {};
  private url = '';

  open(_method: string, url: string, _async: boolean): void {
    this.url = url;
  }
  setRequestHeader(name: string, value: string): void {
    this.headers[name.toLowerCase()] = value;
  }
  abort(): void {
    if (this.onabort) this.onabort();
  }
  send(body: FormData): void {
    lastSentForm = body;
    lastUrl = this.url;
    lastHeaders = this.headers;
    const resp = nextResponse;
    // Simulate progress for assertions when requested.
    if (resp.fireProgress && this.upload.onprogress) {
      this.upload.onprogress({ lengthComputable: true, loaded: 50, total: 100 } as ProgressEvent);
    }
    this.status = resp.status;
    this.responseText = typeof resp.body === 'string'
      ? resp.body
      : JSON.stringify(resp.body);
    if (this.onload) this.onload();
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  nextResponse = { status: 201, body: null };
  lastSentForm = null;
  lastUrl = '';
  lastHeaders = {};
  // @ts-expect-error — replacing the global is the whole point.
  globalThis.XMLHttpRequest = FakeXHR;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_ID = 'session-abc';
const RENTER_DID = 'did:agentbnb:renter-1';

function makeFile(name = 'spec.pdf', size = 1024, type = 'application/pdf'): File {
  return new File([new Uint8Array(size)], name, { type });
}

function makeFileRef(overrides: Partial<ComposerAttachment & { mime_type: string }> = {}): Record<string, unknown> {
  return {
    id: 'file-1',
    session_id: SESSION_ID,
    thread_id: null,
    uploader_did: RENTER_DID,
    filename: 'spec.pdf',
    size_bytes: 1024,
    mime_type: 'application/pdf',
    storage_key: '/tmp/file-1',
    created_at: '2026-05-04T12:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MessageComposer file upload', () => {
  it('uploads a picked file and adds it as a removable pending chip', async () => {
    nextResponse = { status: 201, body: makeFileRef() };
    const onSend = vi.fn();
    const onFileUploaded = vi.fn();

    render(
      <MessageComposer
        sessionId={SESSION_ID}
        callerDid={RENTER_DID}
        onSend={onSend}
        onFileUploaded={onFileUploaded}
      />,
    );

    const file = makeFile();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await userEvent.upload(input, file);

    await waitFor(() => {
      expect(onFileUploaded).toHaveBeenCalledTimes(1);
    });

    expect(onFileUploaded).toHaveBeenCalledWith(expect.objectContaining({
      id: 'file-1',
      filename: 'spec.pdf',
      size_bytes: 1024,
    }));

    // POST hit the right URL with the file under field name 'file'.
    expect(lastUrl).toBe(`/api/sessions/${SESSION_ID}/files`);
    expect(lastSentForm?.get('file')).toBeInstanceOf(File);

    // x-agent-did header populated from callerDid prop.
    expect(lastHeaders['x-agent-did']).toBe(RENTER_DID);

    // Chip is rendered with filename.
    expect(screen.getByText('spec.pdf')).toBeInTheDocument();

    // Chip can be removed.
    const removeBtn = screen.getByRole('button', { name: /remove spec\.pdf/i });
    await userEvent.click(removeBtn);
    expect(screen.queryByText('spec.pdf')).not.toBeInTheDocument();
  });

  it('forwards pending attachments to onSend and clears them after submit', async () => {
    nextResponse = { status: 201, body: makeFileRef() };
    const onSend = vi.fn();

    render(
      <MessageComposer
        sessionId={SESSION_ID}
        callerDid={RENTER_DID}
        onSend={onSend}
      />,
    );

    const file = makeFile();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await userEvent.upload(input, file);
    await waitFor(() => {
      expect(screen.getByText('spec.pdf')).toBeInTheDocument();
    });

    // Type some text and Cmd+Enter to send.
    const textarea = screen.getByPlaceholderText(/Type your message/);
    await userEvent.type(textarea, 'check this');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');

    expect(onSend).toHaveBeenCalledTimes(1);
    const [content, attachments] = onSend.mock.calls[0];
    expect(content).toBe('check this');
    expect(attachments).toEqual([
      expect.objectContaining({ id: 'file-1', filename: 'spec.pdf' }),
    ]);

    // Pending chip is cleared after send.
    expect(screen.queryByText('spec.pdf')).not.toBeInTheDocument();
  });

  it('shows a friendly error when the server returns 413', async () => {
    nextResponse = { status: 413, body: { error: 'File exceeds 10 MB limit' } };

    render(
      <MessageComposer
        sessionId={SESSION_ID}
        callerDid={RENTER_DID}
        onSend={vi.fn()}
      />,
    );

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await userEvent.upload(input, makeFile('big.pdf'));

    await waitFor(() => {
      expect(screen.getByText('File too large (max 10 MB)')).toBeInTheDocument();
    });
  });

  it('shows a friendly error when the server returns 403', async () => {
    nextResponse = { status: 403, body: { error: 'Not a session participant' } };

    render(
      <MessageComposer
        sessionId={SESSION_ID}
        callerDid={RENTER_DID}
        onSend={vi.fn()}
      />,
    );

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await userEvent.upload(input, makeFile('outsider.pdf'));

    await waitFor(() => {
      expect(screen.getByText("You're not a participant of this session")).toBeInTheDocument();
    });
  });

  it('blocks oversize files client-side without hitting the network', async () => {
    nextResponse = { status: 201, body: makeFileRef() };

    render(
      <MessageComposer
        sessionId={SESSION_ID}
        callerDid={RENTER_DID}
        onSend={vi.fn()}
      />,
    );

    // 11 MB > server cap.
    const oversize = makeFile('huge.bin', 11 * 1024 * 1024);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await userEvent.upload(input, oversize);

    await waitFor(() => {
      expect(screen.getByText('File too large (max 10 MB)')).toBeInTheDocument();
    });
    expect(lastSentForm).toBeNull();
  });

  it('allows attachment-only sends (no text body)', async () => {
    nextResponse = { status: 201, body: makeFileRef() };
    const onSend = vi.fn();

    render(
      <MessageComposer
        sessionId={SESSION_ID}
        callerDid={RENTER_DID}
        onSend={onSend}
      />,
    );

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await userEvent.upload(input, makeFile());
    await waitFor(() => {
      expect(screen.getByText('spec.pdf')).toBeInTheDocument();
    });

    // Send button should be enabled even with empty draft.
    const sendBtn = screen.getByRole('button', { name: /send/i });
    expect(sendBtn).not.toBeDisabled();
    await userEvent.click(sendBtn);

    expect(onSend).toHaveBeenCalledWith('', [
      expect.objectContaining({ id: 'file-1' }),
    ]);
  });

  it('runs concurrent uploads independently', async () => {
    // Two distinct fileIds to prove each upload tracks its own chip.
    const responses: ScriptedResponse[] = [
      { status: 201, body: makeFileRef({ id: 'file-a', filename: 'a.txt' }) },
      { status: 201, body: makeFileRef({ id: 'file-b', filename: 'b.txt' }) },
    ];
    let i = 0;
    const origSend = FakeXHR.prototype.send;
    FakeXHR.prototype.send = function (body: FormData): void {
      nextResponse = responses[i++];
      origSend.call(this, body);
    };

    const onFileUploaded = vi.fn();
    render(
      <MessageComposer
        sessionId={SESSION_ID}
        callerDid={RENTER_DID}
        onSend={vi.fn()}
        onFileUploaded={onFileUploaded}
      />,
    );

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await userEvent.upload(input, [makeFile('a.txt'), makeFile('b.txt')]);

    await waitFor(() => {
      expect(onFileUploaded).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByText('a.txt')).toBeInTheDocument();
    expect(screen.getByText('b.txt')).toBeInTheDocument();
  });
});
