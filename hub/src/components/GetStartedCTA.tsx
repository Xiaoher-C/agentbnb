/**
 * GetStartedCTA — Call-to-action button for unauthenticated visitors.
 *
 * Links to the in-browser Hub signup flow (/#/signup), which renders
 * HubAuthForm for WebCrypto keypair + passphrase registration.
 * No CLI required.
 */
export default function GetStartedCTA(): JSX.Element {
  return (
    <a
      href="#/signup"
      className="px-4 py-1.5 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-400 transition-colors"
    >
      Get Started — 50 free credits
    </a>
  );
}
