import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runPendingMigrations } from '../migrations/runner.js';
import { registryMigrations } from '../migrations/registry-migrations.js';
import type {
  Thread,
  Rating,
  OutcomePage,
  Participant,
  SessionMode,
  FileRef,
  SessionMessage,
  ParticipantRole,
} from '../session/session-types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum upload size per file. v10 keeps this small to discourage large blobs. */
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;

/**
 * Options for the v10 rental session REST routes plugin.
 */
export interface SessionRoutesOptions {
  /** Open registry database — must contain rental_sessions / rental_ratings / rental_threads tables. */
  registryDb: Database.Database;
  /**
   * Optional URL where the relay WebSocket lives. Returned to clients on session
   * creation so they know where to connect for live messages. Default uses the
   * same host as the HTTP server.
   */
  relayBaseUrl?: string;
}

// ---------------------------------------------------------------------------
// Storage row shapes
// ---------------------------------------------------------------------------

interface RentalSessionRow {
  id: string;
  renter_did: string;
  owner_did: string;
  agent_id: string;
  card_id: string | null;
  status: 'open' | 'active' | 'paused' | 'closing' | 'settled' | 'closed';
  escrow_id: string | null;
  duration_min: number;
  budget_credits: number;
  spent_credits: number;
  current_mode: SessionMode;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  end_reason: string | null;
  outcome_json: string | null;
  share_token: string | null;
}

interface RentalThreadRow {
  id: string;
  session_id: string;
  title: string;
  description: string;
  status: 'in_progress' | 'completed';
  created_at: string;
  completed_at: string | null;
}

interface RentalRatingRow {
  id: string;
  session_id: string;
  rater_did: string;
  rated_agent_id: string;
  stars: number;
  comment: string;
  created_at: string;
}

interface SessionMessageRow {
  id: string;
  session_id: string;
  thread_id: string | null;
  sender_did: string;
  sender_role: string;
  content: string;
  attachments: string | null;
  is_human_intervention: number;
  created_at: number;
}

interface SessionFileRow {
  id: string;
  session_id: string;
  thread_id: string | null;
  uploader_did: string;
  filename: string;
  size_bytes: number;
  mime_type: string;
  storage_key: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Public DTO shapes (returned over the wire)
// ---------------------------------------------------------------------------

interface SessionDTO {
  id: string;
  renter_did: string;
  owner_did: string;
  agent_id: string;
  status: RentalSessionRow['status'];
  duration_min: number;
  budget_credits: number;
  spent_credits: number;
  current_mode: SessionMode;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  end_reason: string | null;
  share_token: string | null;
  participants: Participant[];
  threads: Thread[];
}

interface CreateSessionInput {
  renter_did: string;
  owner_did: string;
  agent_id: string;
  card_id?: string;
  duration_min: number;
  budget_credits: number;
  current_mode?: SessionMode;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToThread(row: RentalThreadRow): Thread {
  return {
    id: row.id,
    session_id: row.session_id,
    title: row.title,
    description: row.description,
    status: row.status,
    created_at: row.created_at,
    completed_at: row.completed_at,
  };
}

function rowToSession(row: RentalSessionRow, threads: Thread[]): SessionDTO {
  return {
    id: row.id,
    renter_did: row.renter_did,
    owner_did: row.owner_did,
    agent_id: row.agent_id,
    status: row.status,
    duration_min: row.duration_min,
    budget_credits: row.budget_credits,
    spent_credits: row.spent_credits,
    current_mode: row.current_mode,
    created_at: row.created_at,
    started_at: row.started_at,
    ended_at: row.ended_at,
    end_reason: row.end_reason,
    share_token: row.share_token,
    participants: [
      { did: row.renter_did, role: 'renter_human' },
      { did: row.owner_did, role: 'rented_agent' },
    ],
    threads,
  };
}

function loadThreads(db: Database.Database, sessionId: string): Thread[] {
  const rows = db
    .prepare<[string], RentalThreadRow>(
      'SELECT * FROM rental_threads WHERE session_id = ? ORDER BY created_at ASC',
    )
    .all(sessionId);
  return rows.map(rowToThread);
}

function loadSession(db: Database.Database, id: string): SessionDTO | null {
  const row = db
    .prepare<[string], RentalSessionRow>('SELECT * FROM rental_sessions WHERE id = ?')
    .get(id);
  if (!row) return null;
  return rowToSession(row, loadThreads(db, id));
}

function loadRating(db: Database.Database, sessionId: string): Rating | null {
  const row = db
    .prepare<[string], RentalRatingRow>(
      'SELECT * FROM rental_ratings WHERE session_id = ? ORDER BY created_at DESC LIMIT 1',
    )
    .get(sessionId);
  if (!row) return null;
  return {
    session_id: row.session_id,
    rater_did: row.rater_did,
    rated_agent_id: row.rated_agent_id,
    stars: row.stars as Rating['stars'],
    comment: row.comment,
    created_at: row.created_at,
  };
}

/**
 * Build an OutcomePage snapshot from current DB state.
 *
 * Used by both `POST /api/sessions/:id/end` (to persist outcome_json) and
 * `GET /o/:share_token` (to render public outcome). Pure function over DB
 * state, no side effects.
 */
function buildOutcome(db: Database.Database, session: RentalSessionRow): OutcomePage {
  const threads = loadThreads(db, session.id);
  const rating = loadRating(db, session.id);

  const startMs = session.started_at ? Date.parse(session.started_at) : Date.parse(session.created_at);
  const endMs = session.ended_at ? Date.parse(session.ended_at) : Date.now();
  const durationSeconds = Math.max(0, Math.round((endMs - startMs) / 1000));

  return {
    generated_at: new Date().toISOString(),
    summary: {
      messages: 0, // populated when message persistence lands (Phase 2)
      tasks_done: threads.filter(t => t.status === 'completed').length,
      files: 0, // populated when file upload lands (Phase 2)
      credit_used: session.spent_credits,
      credit_refunded: Math.max(0, session.budget_credits - session.spent_credits),
      duration_seconds: durationSeconds,
    },
    threads,
    participants: [
      { did: session.renter_did, role: 'renter_human' },
      { did: session.owner_did, role: 'rented_agent' },
    ],
    rating,
    share_token: session.share_token ?? '',
  };
}

// ---------------------------------------------------------------------------
// File storage + auth helpers (v10 messages/files endpoints)
// ---------------------------------------------------------------------------

/**
 * Returns the directory where session-scoped files are persisted.
 * Honors `AGENTBNB_DIR` so tests can redirect into a tmpdir.
 */
function getSessionFilesDir(sessionId: string): string {
  const root = process.env['AGENTBNB_DIR'] ?? join(homedir(), '.agentbnb');
  return join(root, 'sessions', sessionId, 'files');
}

/**
 * Extracts the caller DID from a request.
 *
 * Accepts either:
 *   - `x-agent-did: <did>` header (preferred — used by Hub WS clients)
 *   - `Authorization: Bearer <did>` (legacy — UCAN/JWT may live here in v2)
 *
 * Returns `null` when no DID can be parsed. Callers must enforce policy.
 */
function extractCallerDid(request: FastifyRequest): string | null {
  const headerDid = request.headers['x-agent-did'];
  if (typeof headerDid === 'string' && headerDid.length > 0) {
    return headerDid;
  }
  const authz = request.headers.authorization;
  if (typeof authz === 'string' && authz.startsWith('Bearer ')) {
    const value = authz.slice('Bearer '.length).trim();
    if (value.length > 0) return value;
  }
  return null;
}

/**
 * Looks up a session and confirms the caller is a participant
 * (renter or owner). Returns the session row, or replies with 401/403/404
 * as appropriate and returns null.
 */
function requireParticipant(
  db: Database.Database,
  request: FastifyRequest,
  reply: FastifyReply,
  sessionId: string,
): RentalSessionRow | null {
  const row = db
    .prepare<[string], RentalSessionRow>('SELECT * FROM rental_sessions WHERE id = ?')
    .get(sessionId);
  if (!row) {
    reply.code(404).send({ error: 'Session not found' });
    return null;
  }
  const callerDid = extractCallerDid(request);
  if (!callerDid) {
    reply.code(401).send({ error: 'Caller DID required (x-agent-did header)' });
    return null;
  }
  if (callerDid !== row.renter_did && callerDid !== row.owner_did) {
    reply.code(403).send({ error: 'Not a session participant' });
    return null;
  }
  return row;
}

function rowToMessage(row: SessionMessageRow): SessionMessage {
  let attachments: FileRef[] | undefined;
  if (row.attachments) {
    try {
      const parsed = JSON.parse(row.attachments) as FileRef[];
      if (Array.isArray(parsed)) attachments = parsed;
    } catch {
      // ignore — corrupt JSON is treated as no attachments
    }
  }

  // Map persisted role onto the legacy binary `sender` discriminator so
  // existing consumers keep working alongside the v10 fields.
  const role = row.sender_role as ParticipantRole;
  const legacySender: 'requester' | 'provider' =
    role === 'rented_agent' ? 'provider' : 'requester';

  return {
    id: row.id,
    session_id: row.session_id,
    sender: legacySender,
    content: row.content,
    timestamp: new Date(row.created_at).toISOString(),
    thread_id: row.thread_id ?? null,
    is_human_intervention: row.is_human_intervention === 1,
    sender_did: row.sender_did,
    sender_role: role,
    attachments,
  };
}

/**
 * Cursor format: base64 of `${createdAtMs}:${id}`. Opaque to clients.
 * Allows stable ordering across messages with identical timestamps.
 */
function encodeCursor(createdAt: number, id: string): string {
  return Buffer.from(`${createdAt}:${id}`, 'utf8').toString('base64url');
}

interface DecodedCursor {
  createdAt: number;
  id: string;
}

function decodeCursor(cursor: string | undefined): DecodedCursor | null {
  if (!cursor) return null;
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const colon = decoded.indexOf(':');
    if (colon <= 0) return null;
    const createdAt = Number(decoded.slice(0, colon));
    const id = decoded.slice(colon + 1);
    if (!Number.isFinite(createdAt) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Fastify plugin that registers the v10 rental session REST surface.
 *
 * Endpoints (all under /api/sessions/* unless noted):
 *   POST   /api/sessions                            — create a session record
 *   GET    /api/sessions/:id                        — read session metadata
 *   POST   /api/sessions/:id/end                    — terminate + build outcome
 *   GET    /api/sessions/:id/outcome                — outcome snapshot (auth required)
 *   POST   /api/sessions/:id/rating                 — submit renter rating
 *   POST   /api/sessions/:id/threads                — open a task thread
 *   POST   /api/sessions/:id/threads/:tid/complete  — mark thread complete
 *   GET    /api/sessions/:id/messages               — paginated message read (participant only)
 *   POST   /api/sessions/:id/files                  — multipart file upload (participant only)
 *   GET    /api/sessions/:id/files/:file_id         — stream a stored file (participant only)
 *   GET    /o/:share_token                          — public outcome read (no auth)
 *
 * Live messaging (real-time fan-out) lives on the WebSocket relay
 * (`src/relay/websocket-relay.ts`); the REST `/messages` endpoint is for
 * paginated history reads only.
 *
 * Privacy contract (ADR-024): rental session message content is only
 * persisted when the relay opts in (`session_mode: true` is honoured by
 * `request_log`). These routes read whatever the relay chose to persist —
 * if no rows exist, callers receive an empty page. See
 * `src/session/privacy.test.ts`.
 */
export async function sessionRoutesPlugin(
  fastify: FastifyInstance,
  options: SessionRoutesOptions,
): Promise<void> {
  const { registryDb: db } = options;

  // Ensure the v10 rental tables exist (idempotent — runner skips already-applied migrations)
  runPendingMigrations(db, registryMigrations);

  // @fastify/multipart throws if registered twice on the same instance, so
  // skip when a host application already wired it up.
  if (!fastify.hasContentTypeParser('multipart/form-data')) {
    const multipart = await import('@fastify/multipart');
    await fastify.register(multipart.default, {
      limits: {
        fileSize: MAX_FILE_BYTES,
        files: 1,
      },
    });
  }

  // POST /api/sessions — create a new rental session record
  fastify.post('/api/sessions', {
    schema: {
      tags: ['rental-sessions'],
      summary: 'Create a new rental session (ADR-022 / ADR-023)',
      body: {
        type: 'object',
        required: ['renter_did', 'owner_did', 'agent_id', 'duration_min', 'budget_credits'],
        properties: {
          renter_did: { type: 'string', minLength: 1 },
          owner_did: { type: 'string', minLength: 1 },
          agent_id: { type: 'string', minLength: 1 },
          card_id: { type: 'string' },
          duration_min: { type: 'integer', minimum: 1, maximum: 720 },
          budget_credits: { type: 'integer', minimum: 1 },
          current_mode: { type: 'string', enum: ['direct', 'proxy'] },
        },
      },
    },
  }, async (request, reply) => {
    const input = request.body as CreateSessionInput;
    const id = randomUUID();
    const shareToken = randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO rental_sessions
        (id, renter_did, owner_did, agent_id, card_id, status, escrow_id,
         duration_min, budget_credits, spent_credits, current_mode,
         created_at, started_at, ended_at, end_reason, outcome_json, share_token)
      VALUES (?, ?, ?, ?, ?, 'open', NULL, ?, ?, 0, ?, ?, NULL, NULL, NULL, NULL, ?)
    `).run(
      id,
      input.renter_did,
      input.owner_did,
      input.agent_id,
      input.card_id ?? null,
      input.duration_min,
      input.budget_credits,
      input.current_mode ?? 'direct',
      now,
      shareToken,
    );

    return reply.code(201).send({
      session_id: id,
      share_token: shareToken,
      relay_url: options.relayBaseUrl ?? '/ws',
      status: 'open',
    });
  });

  // GET /api/sessions/:id — read session metadata
  fastify.get('/api/sessions/:id', {
    schema: {
      tags: ['rental-sessions'],
      summary: 'Read a rental session by id',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = loadSession(db, id);
    if (!session) {
      return reply.code(404).send({ error: 'Session not found' });
    }
    return reply.send(session);
  });

  // POST /api/sessions/:id/end — terminate + build outcome
  fastify.post('/api/sessions/:id/end', {
    schema: {
      tags: ['rental-sessions'],
      summary: 'End a rental session and persist its outcome page',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      body: {
        type: 'object',
        properties: {
          end_reason: {
            type: 'string',
            enum: ['completed', 'timeout', 'budget_exhausted', 'error', 'cancelled'],
          },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { end_reason?: string };

    const row = db
      .prepare<[string], RentalSessionRow>('SELECT * FROM rental_sessions WHERE id = ?')
      .get(id);
    if (!row) {
      return reply.code(404).send({ error: 'Session not found' });
    }
    if (row.status === 'closed' || row.status === 'settled') {
      return reply.code(409).send({ error: 'Session already ended' });
    }

    const now = new Date().toISOString();
    const ended: RentalSessionRow = {
      ...row,
      status: 'closed',
      ended_at: now,
      end_reason: body.end_reason ?? 'completed',
    };

    const outcome = buildOutcome(db, ended);

    db.prepare(`
      UPDATE rental_sessions
      SET status = ?, ended_at = ?, end_reason = ?, outcome_json = ?
      WHERE id = ?
    `).run(ended.status, ended.ended_at, ended.end_reason, JSON.stringify(outcome), id);

    return reply.send({ session_id: id, outcome });
  });

  // GET /api/sessions/:id/outcome — outcome snapshot (auth required, fresh build if not yet cached)
  fastify.get('/api/sessions/:id/outcome', {
    schema: {
      tags: ['rental-sessions'],
      summary: 'Read the outcome page snapshot for a session',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = db
      .prepare<[string], RentalSessionRow>('SELECT * FROM rental_sessions WHERE id = ?')
      .get(id);
    if (!row) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    // Prefer persisted outcome (post-end) over fresh-built (in-progress)
    if (row.outcome_json) {
      try {
        return reply.send(JSON.parse(row.outcome_json) as OutcomePage);
      } catch {
        // Corrupted — fall through to fresh build
      }
    }
    return reply.send(buildOutcome(db, row));
  });

  // POST /api/sessions/:id/rating — submit renter rating
  fastify.post('/api/sessions/:id/rating', {
    schema: {
      tags: ['rental-sessions'],
      summary: 'Submit a renter rating for a completed session',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      body: {
        type: 'object',
        required: ['rater_did', 'stars'],
        properties: {
          rater_did: { type: 'string', minLength: 1 },
          stars: { type: 'integer', minimum: 1, maximum: 5 },
          comment: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { id: sessionId } = request.params as { id: string };
    const { rater_did, stars, comment } = request.body as {
      rater_did: string;
      stars: number;
      comment?: string;
    };

    const session = db
      .prepare<[string], RentalSessionRow>('SELECT id, agent_id FROM rental_sessions WHERE id = ?')
      .get(sessionId);
    if (!session) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    const ratingId = randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO rental_ratings (id, session_id, rater_did, rated_agent_id, stars, comment, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(ratingId, sessionId, rater_did, session.agent_id, stars, comment ?? '', now);

    return reply.code(201).send({ rating_id: ratingId });
  });

  // POST /api/sessions/:id/threads — open a task thread
  fastify.post('/api/sessions/:id/threads', {
    schema: {
      tags: ['rental-sessions'],
      summary: 'Open a task thread within a session',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      body: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', minLength: 1 },
          description: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { id: sessionId } = request.params as { id: string };
    const { title, description } = request.body as { title: string; description?: string };

    const session = db
      .prepare<[string], { id: string }>('SELECT id FROM rental_sessions WHERE id = ?')
      .get(sessionId);
    if (!session) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    const threadId = randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO rental_threads (id, session_id, title, description, status, created_at, completed_at)
      VALUES (?, ?, ?, ?, 'in_progress', ?, NULL)
    `).run(threadId, sessionId, title, description ?? '', now);

    return reply.code(201).send({ thread_id: threadId });
  });

  // POST /api/sessions/:id/threads/:tid/complete — mark thread complete
  fastify.post('/api/sessions/:id/threads/:tid/complete', {
    schema: {
      tags: ['rental-sessions'],
      summary: 'Mark a task thread as completed',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          tid: { type: 'string' },
        },
        required: ['id', 'tid'],
      },
    },
  }, async (request, reply) => {
    const { tid } = request.params as { id: string; tid: string };
    const now = new Date().toISOString();
    const result = db.prepare(`
      UPDATE rental_threads
      SET status = 'completed', completed_at = ?
      WHERE id = ? AND status = 'in_progress'
    `).run(now, tid);

    if (result.changes === 0) {
      return reply.code(404).send({ error: 'Thread not found or already completed' });
    }
    return reply.send({ thread_id: tid, completed_at: now });
  });

  // GET /api/sessions/:id/messages — paginated message read (participant only)
  fastify.get('/api/sessions/:id/messages', {
    schema: {
      tags: ['rental-sessions'],
      summary: 'Read paginated session messages (cursor-based)',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      querystring: {
        type: 'object',
        properties: {
          cursor: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: MAX_PAGE_LIMIT },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!requireParticipant(db, request, reply, id)) return;

    const query = (request.query ?? {}) as { cursor?: string; limit?: number };
    const limit = Math.min(query.limit ?? DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);
    const decoded = decodeCursor(query.cursor);

    // Fetch one extra row to detect if there is a next page.
    const rows = decoded
      ? db
          .prepare<[string, number, number, string, number], SessionMessageRow>(
            `SELECT * FROM session_messages
             WHERE session_id = ?
               AND (created_at > ? OR (created_at = ? AND id > ?))
             ORDER BY created_at ASC, id ASC
             LIMIT ?`,
          )
          .all(id, decoded.createdAt, decoded.createdAt, decoded.id, limit + 1)
      : db
          .prepare<[string, number], SessionMessageRow>(
            `SELECT * FROM session_messages
             WHERE session_id = ?
             ORDER BY created_at ASC, id ASC
             LIMIT ?`,
          )
          .all(id, limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last.created_at, last.id) : null;

    return reply.send({
      messages: page.map(rowToMessage),
      next_cursor: nextCursor,
    });
  });

  // POST /api/sessions/:id/files — multipart file upload (participant only)
  fastify.post('/api/sessions/:id/files', {
    schema: {
      tags: ['rental-sessions'],
      summary: 'Upload a file scoped to a rental session',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = requireParticipant(db, request, reply, id);
    if (!session) return;

    if (!request.isMultipart()) {
      return reply.code(400).send({ error: 'multipart/form-data required' });
    }

    const part = await request.file({ limits: { fileSize: MAX_FILE_BYTES } });
    if (!part) {
      return reply.code(400).send({ error: 'Missing file field' });
    }

    const fileId = randomUUID();
    const safeFilename = part.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
    const dir = getSessionFilesDir(id);
    await mkdir(dir, { recursive: true });
    const storageKey = join(dir, `${fileId}-${safeFilename}`);

    try {
      await pipeline(part.file, createWriteStream(storageKey));
    } catch (err) {
      // Best-effort cleanup; ignore if the file never landed.
      await unlink(storageKey).catch(() => {});
      throw err;
    }

    // `truncated` is set by busboy when fileSize cap is hit mid-stream.
    if (part.file.truncated) {
      await unlink(storageKey).catch(() => {});
      return reply.code(413).send({ error: 'File exceeds 10 MB limit' });
    }

    const callerDid = extractCallerDid(request) as string;
    const now = new Date().toISOString();

    const fileRef: FileRef = {
      id: fileId,
      session_id: id,
      thread_id: null,
      uploader_did: callerDid,
      filename: part.filename,
      size_bytes: part.file.bytesRead,
      mime_type: part.mimetype,
      storage_key: storageKey,
      created_at: now,
    };

    db.prepare(`
      INSERT INTO session_files
        (id, session_id, thread_id, uploader_did, filename, size_bytes, mime_type, storage_key, created_at)
      VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)
    `).run(
      fileRef.id,
      fileRef.session_id,
      fileRef.uploader_did,
      fileRef.filename,
      fileRef.size_bytes,
      fileRef.mime_type,
      fileRef.storage_key,
      fileRef.created_at,
    );

    return reply.code(201).send(fileRef);
  });

  // GET /api/sessions/:id/files/:file_id — stream a stored file (participant only)
  fastify.get('/api/sessions/:id/files/:file_id', {
    schema: {
      tags: ['rental-sessions'],
      summary: 'Download a file from a rental session',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          file_id: { type: 'string' },
        },
        required: ['id', 'file_id'],
      },
    },
  }, async (request, reply) => {
    const { id, file_id } = request.params as { id: string; file_id: string };
    if (!requireParticipant(db, request, reply, id)) return;

    const row = db
      .prepare<[string, string], SessionFileRow>(
        'SELECT * FROM session_files WHERE id = ? AND session_id = ?',
      )
      .get(file_id, id);
    if (!row) {
      return reply.code(404).send({ error: 'File not found' });
    }

    try {
      await stat(row.storage_key);
    } catch {
      return reply.code(404).send({ error: 'File not found' });
    }

    reply
      .header('content-type', row.mime_type || 'application/octet-stream')
      .header('content-length', String(row.size_bytes))
      .header(
        'content-disposition',
        `attachment; filename="${row.filename.replace(/"/g, '\\"')}"`,
      );
    return reply.send(createReadStream(row.storage_key));
  });

  // GET /o/:share_token — public outcome read (no auth)
  fastify.get('/o/:share_token', {
    schema: {
      tags: ['rental-sessions'],
      summary: 'Public outcome page read by share token (no auth)',
      params: {
        type: 'object',
        properties: { share_token: { type: 'string' } },
        required: ['share_token'],
      },
    },
  }, async (request, reply) => {
    const { share_token } = request.params as { share_token: string };
    const row = db
      .prepare<[string], RentalSessionRow>('SELECT * FROM rental_sessions WHERE share_token = ?')
      .get(share_token);
    if (!row) {
      return reply.code(404).send({ error: 'Outcome not found' });
    }

    if (row.outcome_json) {
      try {
        return reply.send(JSON.parse(row.outcome_json) as OutcomePage);
      } catch {
        // fall through
      }
    }
    return reply.send(buildOutcome(db, row));
  });
}
