/**
 * RequestHistory — Table component showing owner request log entries.
 *
 * Displays a dark-themed table with columns: Card Name, Status, Latency,
 * Credits, Time. Status is colour-coded: green for success, red for failure,
 * yellow for timeout. Shows an empty state when no requests are present.
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
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 px-6 py-8 text-center">
        <p className="text-sm text-slate-400">No requests yet</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-700">
      <table className="w-full text-sm text-slate-300">
        <thead className="bg-slate-800 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-3 text-left">Card Name</th>
            <th className="px-4 py-3 text-left">Status</th>
            <th className="px-4 py-3 text-right">Latency</th>
            <th className="px-4 py-3 text-right">Credits</th>
            <th className="px-4 py-3 text-right">Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700/50 bg-slate-900/50">
          {requests.map((req) => (
            <tr key={req.id} className="hover:bg-slate-800/40 transition-colors">
              <td className="px-4 py-3 font-medium text-slate-200">{req.card_name}</td>
              <td className="px-4 py-3">
                <span className={STATUS_CLASSES[req.status]}>{req.status}</span>
              </td>
              <td className="px-4 py-3 text-right text-slate-400">{req.latency_ms} ms</td>
              <td className="px-4 py-3 text-right text-slate-400">{req.credits_charged}</td>
              <td className="px-4 py-3 text-right text-slate-500">{formatTime(req.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
