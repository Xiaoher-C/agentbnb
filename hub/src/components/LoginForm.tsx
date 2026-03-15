/**
 * LoginForm — API key input form for AgentBnB Hub owner authentication.
 *
 * Styled with Tailwind dark theme (slate-800 bg, emerald accents) to match
 * the existing Hub aesthetic. Calls onLogin(key) on form submit.
 */
import { useState } from 'react';

export interface LoginFormProps {
  /** Called with the entered API key when the form is submitted. */
  onLogin: (key: string) => void;
}

/**
 * API key input form. Renders a monospace text field and a Connect button.
 *
 * @param props.onLogin - Callback invoked with the trimmed API key on submit.
 */
export default function LoginForm({ onLogin }: LoginFormProps): JSX.Element {
  const [key, setKey] = useState('');

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) return;
    onLogin(trimmed);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-8 shadow-2xl">
        {/* Logo / header */}
        <div className="mb-8 text-center">
          <h1 className="mb-2 text-2xl font-bold text-white">AgentBnB Hub</h1>
          <p className="text-sm text-slate-400">
            Enter your API key to access your owner dashboard
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="api-key-input" className="mb-2 block text-sm font-medium text-slate-300">
              API Key
            </label>
            <input
              id="api-key-input"
              type="text"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Paste your API key"
              className="w-full rounded-lg border border-slate-600 bg-slate-900 px-4 py-3 font-mono text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 active:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Connect
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-500">
          Find your API key in your AgentBnB config file
        </p>
      </div>
    </div>
  );
}
