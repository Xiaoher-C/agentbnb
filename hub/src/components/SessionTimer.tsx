/**
 * SessionTimer — Counts elapsed and remaining time within a rental session.
 *
 * Source of truth is the server-supplied `started_at` and `duration_min`.
 * Updates every second via setInterval. When remaining hits zero, the timer
 * stays at "0:00" and the UI takes the cue to disable composer / surface
 * "session expired" copy via `onExpire`.
 */
import { useEffect, useMemo, useState } from 'react';
import { Clock, AlertTriangle } from 'lucide-react';

interface SessionTimerProps {
  /** ISO timestamp of when the session started. Null = not yet started (creating). */
  startedAt: string | null;
  /** Duration in minutes — usually 30 or 60. */
  durationMin: number;
  /** Called once when the timer first hits 00:00. */
  onExpire?: () => void;
}

interface TimerParts {
  elapsedSec: number;
  remainingSec: number;
  expired: boolean;
}

/** Pad numbers to 2 digits. */
function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/** Format seconds into M:SS or H:MM:SS. */
function formatDuration(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

/** Compute elapsed / remaining purely. */
function computeParts(startedAt: string | null, durationMin: number, nowMs: number): TimerParts {
  if (!startedAt) {
    return { elapsedSec: 0, remainingSec: durationMin * 60, expired: false };
  }
  const startMs = Date.parse(startedAt);
  if (Number.isNaN(startMs)) {
    return { elapsedSec: 0, remainingSec: durationMin * 60, expired: false };
  }
  const elapsedSec = Math.floor((nowMs - startMs) / 1000);
  const totalSec = durationMin * 60;
  const remainingSec = totalSec - elapsedSec;
  return {
    elapsedSec: Math.max(0, elapsedSec),
    remainingSec: Math.max(0, remainingSec),
    expired: remainingSec <= 0,
  };
}

/**
 * Inline timer chip rendered in the SessionRoom status bar.
 *
 * Visual states:
 *   - >5 minutes left: neutral surface
 *   - <=5 minutes left: amber accent
 *   - expired: rose accent + warning icon
 */
export default function SessionTimer({
  startedAt,
  durationMin,
  onExpire,
}: SessionTimerProps): JSX.Element {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => { setNow(Date.now()); }, 1000);
    return () => { clearInterval(id); };
  }, []);

  const parts = useMemo(() => computeParts(startedAt, durationMin, now), [startedAt, durationMin, now]);

  // Fire onExpire exactly once per mount when we cross the threshold.
  useEffect(() => {
    if (parts.expired && onExpire) {
      onExpire();
    }
    // Intentional: only re-fire when expired flips to true.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts.expired]);

  const lowOnTime = !parts.expired && parts.remainingSec <= 5 * 60;
  const tone = parts.expired
    ? 'border-rose-500/40 bg-rose-500/[0.08] text-rose-300'
    : lowOnTime
      ? 'border-amber-500/40 bg-amber-500/[0.08] text-amber-300'
      : 'border-hub-border-default bg-white/[0.04] text-hub-text-primary';

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${tone}`}
      role="status"
      aria-label={`Session timer: ${formatDuration(parts.remainingSec)} remaining`}
    >
      {parts.expired ? (
        <AlertTriangle size={12} aria-hidden="true" />
      ) : (
        <Clock size={12} aria-hidden="true" />
      )}
      <span className="font-mono">
        {parts.expired ? '0:00 expired' : formatDuration(parts.remainingSec)}
      </span>
      <span className="text-hub-text-muted">/ {durationMin}m</span>
    </div>
  );
}
