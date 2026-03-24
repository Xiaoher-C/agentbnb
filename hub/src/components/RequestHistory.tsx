/**
 * RequestHistory — Table component showing owner request log entries.
 *
 * Displays a dark-themed table with columns: Card Name, Status, Latency,
 * Credits, Time. Status is colour-coded: green for success, red for failure,
 * yellow for timeout. Shows an empty state when no requests are present.
 *
 * Uses hub-* design tokens exclusively (migrated from slate-* in v2.2).
 */
import type { RequestLogEntry } from '../hooks/useRequests.js';

export interface RequestHistoryProps {
  /** Array of request log entries to display. */
  requests: RequestLogEntry[];
}

const STATUS_CLASSES: Record<RequestLogEntry['status'], string> = {
  success: 'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-emerald-900/60 text-emerald-300',
  failure: 'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-red-900/60 text-red-300',
  timeout: 'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-yellow-900/60 text-yellow-300',
};

/** Format an ISO timestamp as a short relative or absolute date. */
function formatTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * Renders a table of request log entries. Shows "No requests yet" when empty.
 */
export default function RequestHistory({ requests }: RequestHistoryProps): JSX.Element {
  if (requests.length === 0) {
    return (
      <div className="rounded-lg border border-hub-border bg-hub-surface px-6 py-8 text-center">
        <p className="text-sm text-hub-text-secondary">No requests yet</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-hub-border">
      <table className="w-full text-sm text-hub-text-secondary">
        <thead style={{ backgroundColor: '#111117' }} className="text-xs uppercase text-hub-text-tertiary">
          <tr>
            <th className="px-4 py-3 text-left">Card Name</th>
            <th className="px-4 py-3 text-left">Status</th>
            <th className="px-4 py-3 text-right">Latency</th>
            <th className="px-4 py-3 text-right">Credits</th>
            <th className="px-4 py-3 text-right">Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hub-border bg-hub-bg">
          {requests.map((req) => (
            <tr key={req.id} className="hover:bg-hub-surface-hover transition-colors">
              <td className="px-4 py-3">
                <span className="font-medium text-hub-text-primary">{req.card_name}</span>
                {req.capability_type != null && (
                  <span className="ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-violet-900/60 text-violet-300">
                    {req.capability_type}
                  </span>
                )}
              </td>
              <td className="px-4 py-3">
                <span className={STATUS_CLASSES[req.status]}>{req.status}</span>
              </td>
              <td className="px-4 py-3 text-right text-hub-text-secondary">{req.latency_ms} ms</td>
              <td className="px-4 py-3 text-right">
                <span className="font-mono text-hub-accent">cr {req.credits_charged}</span>
              </td>
              <td className="px-4 py-3 text-right text-hub-text-tertiary">{formatTime(req.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
