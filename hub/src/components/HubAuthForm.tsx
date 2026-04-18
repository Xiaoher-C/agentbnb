/**
 * HubAuthForm — unified Hub authentication flow.
 *
 * Three modes:
 * 1. register — Create a new agent identity (WebCrypto keypair + passphrase)
 * 2. login — Fetch encrypted identity by email, decrypt with passphrase
 * 3. api-key — Legacy CLI Bearer token flow (for existing users)
 *
 * On success, stores session in localStorage and calls onLogin(apiKey | null).
 * When using DID mode, apiKey is null and callers must use authedFetch() instead.
 */
import { useState } from 'react';
import {
  generateKeypair,
  encryptPrivateKey,
  decryptPrivateKey,
  importPrivateKey,
  signPayload,
  cryptoHelpers,
} from '../lib/crypto.js';
import { saveSession } from '../lib/authHeaders.js';

type Mode = 'landing' | 'register' | 'login' | 'api-key';

export interface HubAuthFormProps {
  onLogin: (key: string | null) => void;
}

export default function HubAuthForm({ onLogin }: HubAuthFormProps): JSX.Element {
  const [mode, setMode] = useState<Mode>('landing');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [passphraseConfirm, setPassphraseConfirm] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRegister(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);

    if (passphrase !== passphraseConfirm) {
      setError('Passphrases do not match');
      return;
    }
    if (passphrase.length < 8) {
      setError('Passphrase must be at least 8 characters');
      return;
    }
    if (!email || !displayName) {
      setError('Email and display name are required');
      return;
    }

    setLoading(true);
    try {
      // 1. Generate keypair
      const kp = await generateKeypair();

      // 2. Encrypt private key with passphrase
      const { encrypted, salt } = await encryptPrivateKey(kp.privateKeyBytes, passphrase);

      // 3. Get a challenge from server
      const challengeRes = await fetch('/api/agents/challenge');
      if (!challengeRes.ok) throw new Error('Failed to get challenge');
      const { challenge } = await challengeRes.json() as { challenge: string };

      // 4. Sign the challenge
      const signature = await signPayload(kp.privateKey, { challenge });

      // 5. Submit registration
      const res = await fetch('/api/agents/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.toLowerCase(),
          public_key: kp.publicKeyHex,
          encrypted_private_key: encrypted,
          kdf_salt: salt,
          display_name: displayName,
          challenge,
          signature,
        }),
      });

      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? `Registration failed (${res.status})`);
      }

      const { agent_id } = await res.json() as { agent_id: string };

      // 6. Store session (unencrypted in localStorage for session)
      saveSession({
        agentId: agent_id,
        publicKeyHex: kp.publicKeyHex,
        privateKeyBase64: cryptoHelpers.bytesToBase64(new Uint8Array(kp.privateKeyBytes)),
      });

      onLogin(null); // DID mode — no API key
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // 1. Fetch encrypted blob
      const res = await fetch('/api/agents/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.toLowerCase() }),
      });
      if (res.status === 404) throw new Error('No account found for this email');
      if (!res.ok) throw new Error(`Login failed (${res.status})`);

      const data = await res.json() as {
        agent_id: string;
        public_key: string;
        encrypted_private_key: string;
        kdf_salt: string;
      };

      // 2. Decrypt with passphrase
      const pkcs8 = await decryptPrivateKey(data.encrypted_private_key, data.kdf_salt, passphrase);

      // 3. Verify by importing (will throw on invalid)
      await importPrivateKey(pkcs8);

      // 4. Save session
      saveSession({
        agentId: data.agent_id,
        publicKeyHex: data.public_key,
        privateKeyBase64: cryptoHelpers.bytesToBase64(new Uint8Array(pkcs8)),
      });

      onLogin(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function handleApiKey(e: React.FormEvent): void {
    e.preventDefault();
    const trimmed = apiKey.trim();
    if (!trimmed) return;
    onLogin(trimmed);
  }

  if (mode === 'landing') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
        <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-8 shadow-2xl">
          <div className="mb-8 text-center">
            <h1 className="mb-2 text-2xl font-bold text-white">AgentBnB Hub</h1>
            <p className="text-sm text-slate-400">
              Onboard your agent to the peer-to-peer capability network.
            </p>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => setMode('register')}
              className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
            >
              Onboard a new agent
            </button>
            <button
              onClick={() => setMode('login')}
              className="w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-600"
            >
              Sign in as operator
            </button>
            <button
              onClick={() => setMode('api-key')}
              className="w-full rounded-lg px-4 py-2 text-xs text-slate-400 transition-colors hover:text-slate-200"
            >
              Use an existing API key (CLI operators)
            </button>
          </div>

          <p className="mt-6 text-center text-xs text-slate-500">
            No CLI needed. Keys are generated in your browser and stay operator-controlled — never sent to the server unencrypted.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-8 shadow-2xl">
        <button
          onClick={() => { setMode('landing'); setError(null); }}
          className="mb-4 text-xs text-slate-400 hover:text-slate-200"
        >
          ← Back
        </button>

        <h1 className="mb-6 text-xl font-bold text-white">
          {mode === 'register' && 'Onboard Agent'}
          {mode === 'login' && 'Operator Sign In'}
          {mode === 'api-key' && 'Operator API Key Login'}
        </h1>

        {error && (
          <div className="mb-4 rounded-lg border border-rose-800 bg-rose-950/40 px-4 py-3 text-sm text-rose-300">
            {error}
          </div>
        )}

        {mode === 'register' && (
          <form onSubmit={handleRegister} className="space-y-4">
            <Field label="Operator email (used as login identifier)" value={email} onChange={setEmail} type="email" required />
            <Field label="Agent display name" value={displayName} onChange={setDisplayName} required />
            <Field label="Operator passphrase (min 8 chars)" value={passphrase} onChange={setPassphrase} type="password" required />
            <Field label="Confirm operator passphrase" value={passphraseConfirm} onChange={setPassphraseConfirm} type="password" required />
            <SubmitButton loading={loading} label="Onboard Agent" />
            <p className="text-center text-xs text-slate-500">
              The agent&apos;s identity key is encrypted with your operator passphrase before being stored on the server.
              You&apos;ll need this passphrase to sign in from another device.
              <br />
              <strong className="text-amber-400">If you forget this passphrase, the agent&apos;s identity cannot be recovered.</strong>
            </p>
          </form>
        )}

        {mode === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <Field label="Operator email" value={email} onChange={setEmail} type="email" required />
            <Field label="Operator passphrase" value={passphrase} onChange={setPassphrase} type="password" required />
            <SubmitButton loading={loading} label="Sign in as operator" />
          </form>
        )}

        {mode === 'api-key' && (
          <form onSubmit={handleApiKey} className="space-y-4">
            <Field label="Operator API key (from ~/.agentbnb/config.json)" value={apiKey} onChange={setApiKey} />
            <SubmitButton loading={false} label="Connect" />
            <p className="text-center text-xs text-slate-500">
              Legacy flow for CLI operators with an existing API key.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', required = false }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}): JSX.Element {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-slate-300">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full rounded-lg border border-slate-600 bg-slate-900 px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        spellCheck={false}
        autoComplete={type === 'password' ? 'current-password' : 'off'}
      />
    </div>
  );
}

function SubmitButton({ loading, label }: { loading: boolean; label: string }): JSX.Element {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 active:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? 'Working…' : label}
    </button>
  );
}
