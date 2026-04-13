/**
 * SignupPage — route wrapper for HubAuthForm.
 *
 * Reached from landing CTAs ("Get Started", "Launch your agent").
 * On successful auth, redirects to the Hub agent list.
 */
import { useEffect } from 'react';
import { useNavigate, useOutletContext } from 'react-router';
import HubAuthForm from '../components/HubAuthForm.js';
import type { AppOutletContext } from '../types.js';

export default function SignupPage(): JSX.Element {
  const { apiKey, login } = useOutletContext<AppOutletContext>();
  const navigate = useNavigate();

  // If already authenticated, bounce to hub agent list
  useEffect(() => {
    if (apiKey) {
      void navigate('/agents/hub', { replace: true });
    }
  }, [apiKey, navigate]);

  return (
    <HubAuthForm
      onLogin={(key) => {
        login(key);
        void navigate('/agents/hub', { replace: true });
      }}
    />
  );
}
