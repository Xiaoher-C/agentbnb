/**
 * AuthGate — Conditional wrapper that shows LoginForm or children based on auth state.
 *
 * Used at the top level of the owner dashboard to gate all authenticated content
 * behind an API key prompt.
 */
import type { ReactNode } from 'react';
import LoginForm from './LoginForm.js';

export interface AuthGateProps {
  /** Current API key from useAuth(). Pass null or undefined when not authenticated. */
  apiKey: string | null | undefined;
  /** Called when the user submits the LoginForm. Should invoke useAuth().login(). */
  onLogin: (key: string) => void;
  /** The authenticated dashboard content to render when apiKey is present. */
  children: ReactNode;
}

/**
 * Renders children when apiKey is present, otherwise shows LoginForm.
 *
 * @param props.apiKey  - API key string, or null/undefined when unauthenticated.
 * @param props.onLogin - Forwarded to LoginForm's onLogin prop.
 * @param props.children - Protected content shown when authenticated.
 */
export default function AuthGate({ apiKey, onLogin, children }: AuthGateProps): JSX.Element {
  if (!apiKey) {
    return <LoginForm onLogin={onLogin} />;
  }
  return <>{children}</>;
}
