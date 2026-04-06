/**
 * AuthGate — Conditional wrapper that shows HubAuthForm or children based on auth state.
 *
 * Supports both legacy Bearer (API key) and new DID-based auth flows via the
 * unified HubAuthForm component.
 */
import type { ReactNode } from 'react';
import HubAuthForm from './HubAuthForm.js';

export interface AuthGateProps {
  /** Current API key from useAuth(). Pass null or undefined when not authenticated. */
  apiKey: string | null | undefined;
  /**
   * Called when the user completes authentication. Pass a key for Bearer mode,
   * or null for DID mode (session was saved via saveSession before calling).
   */
  onLogin: (key: string | null) => void;
  /** The authenticated dashboard content to render when apiKey is present. */
  children: ReactNode;
}

/**
 * Renders children when apiKey is present, otherwise shows HubAuthForm.
 */
export default function AuthGate({ apiKey, onLogin, children }: AuthGateProps): JSX.Element {
  if (!apiKey) {
    return <HubAuthForm onLogin={onLogin} />;
  }
  return <>{children}</>;
}
