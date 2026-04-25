/**
 * Semantic tone system — shared between WorkNetwork and Skills Inspector.
 *
 * Six tones map to concrete Tailwind colour utilities. Components lookup
 * className strings by tone key instead of hard-coding emerald/sky/etc.,
 * so the palette is centralised and both routes stay in sync.
 */

export type Tone = 'live' | 'pinned' | 'team' | 'warn' | 'danger' | 'mute';

/** Pill / chip (soft bg + subtle border + high-contrast text). */
export const TONE_CHIP: Record<Tone, string> = {
  live: 'border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-300',
  pinned: 'border-sky-500/30 bg-sky-500/[0.08] text-sky-300',
  team: 'border-violet-500/30 bg-violet-500/[0.08] text-violet-300',
  warn: 'border-amber-500/30 bg-amber-500/[0.08] text-amber-300',
  danger: 'border-rose-500/30 bg-rose-500/[0.08] text-rose-300',
  mute: 'border-dashed border-slate-500/25 bg-slate-500/[0.06] text-slate-300',
};

/** Vertical accent bar on the left edge of a list row. */
export const TONE_BAR: Record<Tone, string> = {
  live: 'bg-emerald-400',
  pinned: 'bg-sky-400',
  team: 'bg-violet-400',
  warn: 'bg-amber-400',
  danger: 'bg-rose-400',
  mute: 'bg-slate-500',
};

/** Solid dot (presence, accent). */
export const TONE_DOT: Record<Tone, string> = {
  live: 'bg-emerald-400',
  pinned: 'bg-sky-400',
  team: 'bg-violet-400',
  warn: 'bg-amber-400',
  danger: 'bg-rose-400',
  mute: 'bg-slate-500',
};

/** Readable text tone for inline use. */
export const TONE_TEXT: Record<Tone, string> = {
  live: 'text-emerald-300',
  pinned: 'text-sky-300',
  team: 'text-violet-300',
  warn: 'text-amber-300',
  danger: 'text-rose-300',
  mute: 'text-slate-300',
};

/** Lifecycle stage → tone mapping (shared by StageChip and stage progress). */
export const STAGE_TONE: Record<string, Tone> = {
  open: 'mute',
  discussing: 'pinned',
  shortlisted: 'team',
  'in-progress': 'live',
  review: 'warn',
  completed: 'mute',
};
