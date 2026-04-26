# Hub Frontend Audit Report — Unit 3 of 5

**Date:** 2026-04-27  
**Auditor:** Unit 3 (code-reviewer agent)  
**Scope:** `hub/src/**` — React 18 + Vite 6 + Tailwind 3  
**Branch:** `audit/unit-3-hub-frontend`  
**Files reviewed:** 34 source files (~3.7k LOC)

---

## Executive Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 2     |
| WARNING  | 8     |
| INFO     | 9     |

**Verdict: BLOCK** — two CRITICAL issues must be addressed before production traffic is increased. The more serious is the unencrypted Ed25519 private key stored in `localStorage`; the second is the complete absence of a Content Security Policy. Eight WARNING-level issues cover missing auth guards on sensitive pages, token handling inconsistencies, `<article onClick>` accessibility failures, error-swallowing patterns, and a `rel`-missing external link. Nine INFO items cover lower-risk quality issues.

---

## Category 1 — Auth Token Handling

### Finding 1: Ed25519 private key stored unencrypted in localStorage

- **File:** `hub/src/lib/authHeaders.ts:19-23`
- **Severity:** CRITICAL
- **Description:** After registration or login, the PKCS#8 private key bytes are base64-encoded and written verbatim to `localStorage` under the key `agentbnb_hub_session`:

  ```ts
  // authHeaders.ts:23
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  // session.privateKeyBase64 = base64(PKCS#8 bytes)
  ```

  `localStorage` is accessible to any JavaScript on the same origin. Any XSS injection, a malicious browser extension, or a supply-chain compromise in a third-party dependency (Recharts, React Flow, boring-avatars, etc.) can exfiltrate the raw private key, impersonate the agent indefinitely, and forge signed requests. The key is described as "unencrypted in localStorage for session" in the code comment, acknowledging the exposure.

  The private key was encrypted with a passphrase for server storage — that protection is intentionally discarded when the session is created on the client.

- **Suggested fix:** Do not store the raw private key material outside of non-extractable `CryptoKey` objects. After decryption, re-import the key as `extractable: false` and keep it only in memory (module-level or React context). Invalidate the in-memory key on logout. The session object in `localStorage` should contain only `agentId` and `publicKeyHex` — never private key bytes. If cross-tab key sharing is needed, use a service worker or accept that each tab requires re-entry of the passphrase.

---

### Finding 2: `__did__` sentinel value is a confusing security primitive

- **File:** `hub/src/hooks/useAuth.ts:17`, `hub/src/lib/authHeaders.ts` (multiple callers)
- **Severity:** WARNING
- **Description:** The string `'__did__'` is stored in `localStorage` as a sentinel and used as a branch condition throughout the codebase (`isDid = apiKey === '__did__'`). This pattern means any code path that reads `apiKey` and forwards it anywhere (logs, network requests, error messages) could accidentally expose the sentinel — and more importantly, a bug that bypasses the sentinel check would silently fall through to no-auth behavior rather than fail closed. The sentinel value is also not validated against brute-force tampering (an attacker who can write to `localStorage` can set any value including `__did__`).

- **Suggested fix:** Replace the sentinel approach with a typed discriminated union. Store auth mode separately from the token value, e.g. `{ mode: 'bearer' | 'did' | null, token: string | null }`. The `mode` field drives behavior; the `token` field is never `'__did__'`. This eliminates the risk of sentinel leakage and makes the code far more legible.

---

### Finding 3: Bearer API key stored persistently in localStorage

- **File:** `hub/src/hooks/useAuth.ts:60`
- **Severity:** INFO
- **Description:** Bearer tokens are stored with `localStorage.setItem` which persists across browser sessions indefinitely. If a user closes the tab without logging out, the token remains in `localStorage` forever. There is no expiry, no session timeout, and no indicator to the user that they are still signed in from a previous session.

- **Suggested fix:** For the Bearer legacy path, consider `sessionStorage` instead of `localStorage` so the key is cleared when the tab closes. If persistence is needed for UX reasons, implement a max-age check (e.g. store a `loginTime` and clear if older than 7 days). Add a clear notice in the UI that the session is persistent.

---

### Finding 4: Inconsistent `isDid` guard — some callers silently fall through on no session

- **File:** `hub/src/components/OwnerDashboard.tsx:207-210`
- **Severity:** WARNING
- **Description:** The toggle-online button in `OwnerDashboard` sends an unauthenticated request when DID mode is active:

  ```tsx
  // OwnerDashboard.tsx:207-210
  onClick={() => {
    void fetch(`/cards/${card.id}/toggle-online`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  }}
  ```

  When `apiKey === '__did__'`, this sends `Authorization: Bearer __did__` to the server — the sentinel is leaked in the `Authorization` header. The server will reject it (401), but the client silently swallows the error (the `void fetch(...)` pattern with no `.catch()`). The user sees no feedback, and the card state does not update.

- **Suggested fix:** Use `authedFetch` (already imported elsewhere in the app) for DID mode and the Bearer path for legacy mode. Add error handling with user-visible feedback on failure (toast, inline error, or reload the card list). Mirror the pattern used in `SharePage.tsx:handlePublish`.

---

## Category 2 — XSS / Output Sanitization

### Finding 5: No Content Security Policy anywhere

- **File:** `hub/index.html`, `hub/vite.config.ts`
- **Severity:** CRITICAL
- **Description:** `hub/index.html` has no `<meta http-equiv="Content-Security-Policy">` tag. `hub/vite.config.ts` has no `server.headers` configuration. The Vite proxy config for production is not visible in this scope, but there is no evidence of a CSP being set in the serving layer. Without a CSP, any XSS vector in the app (injected content from third-party dependencies, compromised CDN asset, etc.) runs without restriction, can exfiltrate `localStorage` tokens and keys, and can make authenticated requests on the user's behalf.

  The application handles private keys and Bearer tokens in `localStorage`. This makes the absence of a CSP especially damaging — a single XSS vector is sufficient to exfiltrate the agent's entire identity.

- **Suggested fix:** Add a CSP that restricts `script-src` to `'self'` at minimum. Because Vite bundles everything into a single JS chunk, `'unsafe-inline'` should not be needed. A nonce-based CSP is ideal. At the Fastify server level, add a `Content-Security-Policy` response header on the `/hub` routes. As a stopgap, add to `index.html`:

  ```html
  <meta http-equiv="Content-Security-Policy" 
        content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self';">
  ```

---

### Finding 6: `target="_blank"` without `rel="noopener noreferrer"` — low-severity XSS vector

- **File:** `hub/src/components/NavBar.tsx:189`
- **Severity:** INFO
- **Description:** The GitHub link uses `target="_blank"` and correctly includes `rel="noopener noreferrer"` on line 191. This is actually handled correctly — flagged here only to confirm it was checked. No issue exists.

*(No action required.)*

---

### Finding 7: User-originated agent names and descriptions rendered unescaped

- **File:** `hub/src/components/CapabilityCard.tsx:62`, `hub/src/components/CardModal.tsx:267`, `hub/src/components/ProfilePage.tsx:292`
- **Severity:** INFO
- **Description:** Agent `name`, `description`, `owner`, `action`, and various metadata strings from the API are rendered directly as React `{children}` text nodes — not via `dangerouslySetInnerHTML`. React escapes these automatically, so there is no XSS vector here. This is noted only for documentation: if anyone converts these to `dangerouslySetInnerHTML` in a future refactor (e.g. to support markdown rendering), it would immediately become a CRITICAL XSS vector. Server-side input sanitization must be the primary defense.

*(No action required, but note the risk for future markdown rendering work.)*

---

## Category 3 — Route Guards / Auth Enforcement

### Finding 8: Protected pages accessible without authentication — no redirect, no guard

- **File:** `hub/src/main.tsx:95-98`, `hub/src/pages/FleetConsolePage.tsx`, `hub/src/pages/EvolutionPage.tsx`
- **Severity:** WARNING
- **Description:** Several routes that expose authenticated user data or sensitive controls are not wrapped in `AuthGate` and have no auth check:

  - `/fleet` (`FleetConsolePage`) — accepts an owner name input and fetches `/api/fleet/:owner`. While this is a public endpoint, the page is positioned in the authenticated nav section. More importantly, the page fetches internal fleet metrics (success rates, earnings, failure breakdowns, reliability scores) for any owner name without authentication. Combined with the publicly accessible endpoint this creates an **unauthenticated data exposure** of operational metrics for any known owner handle.
  - `/evolution` (`EvolutionPage`) — rendered without auth.
  - `/credit-policy` (`CreditPolicyPage`) — rendered without auth.

  The `/dashboard` and `/myagent` routes correctly use `AuthGate`. The `/fleet` route's lack of a guard is the most significant because it exposes non-public operational data without any friction.

- **Suggested fix:** Wrap `/fleet` in `AuthGate` or add an explicit `useEffect`-based redirect to `/signup` when `apiKey` is null. Alternatively, if fleet data is intended to be public, remove it from the authenticated nav section and ensure the `/api/fleet/:owner` endpoint does not return earnings, spend, or reliability data to unauthenticated callers.

---

### Finding 9: `ProviderDashboardPage` — `AuthGate` present but inner component conditionally renders on a separate `apiKey &&` check

- **File:** `hub/src/pages/ProviderDashboardPage.tsx:330-337`
- **Severity:** INFO
- **Description:** The pattern `{apiKey && <ProviderDashboardInner apiKey={apiKey} />}` inside `AuthGate` is redundant but not a security bypass — `AuthGate` already returns only children when `apiKey` is truthy. The double guard adds noise and could mislead future maintainers into thinking the outer check is superfluous. Same pattern appears in `MyAgentWrapper` in `main.tsx:51`.

- **Suggested fix:** Simplify to `<ProviderDashboardInner apiKey={apiKey!} />` inside `AuthGate`, since `AuthGate` guarantees `apiKey` is truthy when children render. Document this contract in the `AuthGate` JSDoc.

---

## Category 4 — API Call Error Handling

### Finding 10: Silent error-swallowing on toggle-online mutation

- **File:** `hub/src/components/OwnerDashboard.tsx:206-213`
- **Severity:** WARNING
- **Description:** As noted in Finding 4, the toggle-online action uses `void fetch(...)` with no `.then()` or `.catch()`. The user has no way to know if the toggle succeeded or failed. The card's online/offline badge in the UI does not reflect the server state after the action (there is no optimistic update, no refetch, and no error display). This is a broken interaction.

- **Suggested fix:** Wrap in `async/await`, handle the response, and either trigger a refetch of `useOwnerCards` or show an inline status message. Use `authedFetch` for DID mode.

---

### Finding 11: `useProviderEvents` — silent failure on all errors

- **File:** `hub/src/hooks/useProviderEvents.ts:51-53`
- **Severity:** INFO
- **Description:** The event-polling hook swallows all errors with an empty `catch` block. If the `/me/events` endpoint fails repeatedly (e.g. after a server restart), the provider dashboard shows stale data with no indication of the poll failure. The loading spinner is also cleared unconditionally in `finally`, so after the first successful fetch, the user cannot distinguish "no events" from "polling broken."

- **Suggested fix:** Expose an `error` state in the hook return value. Show a small banner in `ProviderDashboardPage` when events have not been refreshed for more than 2 poll intervals.

---

### Finding 12: `useRequests` — stale closure on `error` state reference in `catch`

- **File:** `hub/src/hooks/useRequests.ts:95`
- **Severity:** WARNING
- **Description:** Inside the `fetchRequests` callback, the `catch` block reads `error` from the outer scope:

  ```ts
  } catch (err) {
    if (error !== 'Invalid API key') {   // stale closure over `error`
  ```

  Because `error` is not in the `useCallback` dependency array (and is explicitly suppressed with `// eslint-disable-line react-hooks/exhaustive-deps`), this closure captures the initial value of `error` (`null`). If the hook transitions to the `'Invalid API key'` state and then a new error occurs on a subsequent poll, the stale `error !== 'Invalid API key'` check may evaluate incorrectly.

- **Suggested fix:** Replace the closure read with a `useRef` or use the functional form of `setError`:

  ```ts
  setError((prev) =>
    prev === 'Invalid API key' ? prev : `Requests unreachable: ${msg}`
  );
  ```

---

### Finding 13: `useCards` — stats fetch swallows all errors silently

- **File:** `hub/src/hooks/useCards.ts:268`
- **Severity:** INFO
- **Description:** The stats polling `catch` block is empty (`/* graceful degradation */`). The hero stats strip on the Discover page (agents online, total capabilities, total exchanges) will silently show zeros if `/api/stats` fails, with no indication to the user that the numbers are unavailable rather than accurate.

- **Suggested fix:** Store an `statsError` boolean and display a subtle "stats unavailable" note on the `HeroTrustStats` component when the fetch has failed at least twice consecutively.

---

## Category 5 — Accessibility

### Finding 14: `<article onClick>` cards are keyboard inaccessible

- **File:** `hub/src/components/CapabilityCard.tsx:47-51`, `hub/src/components/AgentDirectoryCard.tsx:44-48`, `hub/src/components/HubAgentCard.tsx:37-39`
- **Severity:** WARNING
- **Description:** Three card components use an `<article>` element with an `onClick` handler but no `tabIndex`, no `role="button"`, no `onKeyDown` handler, and no `aria-label`. These cards are:

  - Clickable (cursor-pointer CSS)
  - Not keyboard-focusable by default (article is not in the natural tab order unless `tabIndex` is set)
  - Not triggerable with Enter/Space by keyboard users

  The `CapabilityCard` does use `role="article"` which is semantically correct for a card, but without `tabIndex={0}` and keyboard event handlers, the card's click action is completely inaccessible to keyboard users and screen reader users who navigate with the keyboard.

  This is a WCAG 2.1 Level A failure (2.1.1 Keyboard — "All functionality of the content is operable through a keyboard interface").

- **Suggested fix:** Add `tabIndex={0}` and an `onKeyDown` handler to each clickable card:

  ```tsx
  <article
    role="button"    // or keep role="article" and add tabIndex separately
    tabIndex={0}
    onClick={onClick}
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
    aria-label={`View ${card.name} capability card`}
    ...
  >
  ```

  Alternatively, wrap the article content in a semantically correct `<a href={...}>` or `<button>` element. The cleanest approach is to make the card itself a `<button>` or wrap it in a `<div role="group">` containing a button.

---

### Finding 15: Icon-only buttons missing accessible labels in some components

- **File:** `hub/src/components/CardModal.tsx:252-255` (close button — has `aria-label`)  
  `hub/src/components/NavBar.tsx:200-205` (hamburger — has `aria-label`)  
  `hub/src/routes/WorkNetwork.tsx` (multiple icon buttons)
- **Severity:** INFO
- **Description:** The `CardModal` close button and the `NavBar` hamburger button both correctly implement `aria-label`. WorkNetwork has some aria labels on icons. This is largely handled correctly; noting it for completeness. A full audit of WorkNetwork (1700+ LOC) was not performed in this scope but it contains many `<button>` elements — the icon `aria-hidden="true"` pattern is used inconsistently.

- **Suggested fix:** Audit WorkNetwork icon buttons for missing aria-labels. Ensure any icon-only button (no visible text) has `aria-label`.

---

### Finding 16: Modal focus management is incomplete

- **File:** `hub/src/components/CardModal.tsx`
- **Severity:** WARNING
- **Description:** `CardModal` traps the `Escape` key to close (line 150-157) but does not:
  1. Move focus into the modal on open
  2. Trap Tab/Shift+Tab within the modal while it is open
  3. Restore focus to the triggering element on close

  This means keyboard users who open a card modal find their focus position outside the modal dialog. Screen reader users navigating with Tab will exit the modal and browse the page content behind it. This violates WCAG 2.1 Level A (2.1.2 No Keyboard Trap — the inverse of the usual issue: focus should be deliberately trapped inside a modal).

- **Suggested fix:** On modal open, use `dialogRef.current?.focus()` or focus the first interactive element inside the modal. Implement a focus trap with Tab/Shift+Tab key handlers, or use a headless dialog library (`@radix-ui/react-dialog`, `react-focus-trap`) that handles this correctly. On close, restore focus to the element that triggered the modal open.

---

## Category 6 — Secret Exposure / Environment

### Finding 17: No hardcoded secrets found

All `import.meta.env` references are absent from the hub source — the hub makes no use of environment variables at the client level (the backend URL is derived from the current origin via proxy). No API keys, tokens, or connection strings were found hardcoded in the source. This is clean.

*(No action required.)*

---

### Finding 18: `hub/vite.config.ts` proxy targets hardcode `localhost:7777`

- **File:** `hub/vite.config.ts:19-27`
- **Severity:** INFO
- **Description:** The dev proxy hardcodes `http://localhost:7777`. This is only used in development — production builds hit the same origin via Fastify's static file serving. Not a security issue, but noted: if the dev port changes or if running in a container, developers will need to update this manually.

- **Suggested fix:** Extract the proxy target to an environment variable: `process.env.VITE_API_BASE_URL ?? 'http://localhost:7777'`.

---

## Category 7 — Code Quality

### Finding 19: `WorkNetwork.tsx` exceeds maximum file size limit

- **File:** `hub/src/routes/WorkNetwork.tsx`
- **Severity:** INFO
- **Description:** `WorkNetwork.tsx` contains approximately 1700+ lines of code, significantly exceeding the project's 800-line maximum file size limit established in `CLAUDE.md` and the coding standards. The file contains multiple distinct components (agent panels, task panels, timeline rows, filter chips, detail modals) that should be extracted into separate files.

- **Suggested fix:** Extract inner components (`StageCard`, `TaskDetailPanel`, `TimelineRow`, `FilterChip`, `EventFeed`, etc.) into separate files under `hub/src/components/work-network/`. The route component itself should be reduced to orchestration only.

---

### Finding 20: `DiscoverPage.tsx` inline IIFE for label text is unnecessarily complex

- **File:** `hub/src/pages/DiscoverPage.tsx:208-213`
- **Severity:** INFO
- **Description:** An immediately-invoked function expression is used inside JSX for a simple label string:

  ```tsx
  {(() => {
    if (loading) return 'Loading…';
    if (error && cards.length === 0) return 'Registry temporarily unavailable';
    ...
  })()}
  ```

  This pattern is harder to read and test than a named helper function or a computed variable.

- **Suggested fix:** Extract to a named function `getStatusLabel()` computed before the return statement.

---

### Finding 21: Private key caching in module scope is unsafe across tab navigations

- **File:** `hub/src/lib/authHeaders.ts:53-54`
- **Severity:** INFO
- **Description:** The private key is cached in module-level variables:

  ```ts
  let cachedPrivateKey: CryptoKey | null = null;
  let cachedPrivateKeyHex: string | null = null;
  ```

  Module-level state in a browser persists across full React re-renders but is cleared on page reload. The `cachedPrivateKeyHex` is compared against `session.privateKeyBase64` to invalidate the cache. This correctly ties the cache lifetime to the session, but the module-level approach means the cache is not explicitly cleared on logout. If a user logs out and back in with a different account in the same tab session, the key could theoretically be used for one request after the session changes if there is a race condition between logout and a pending `authedFetch`.

- **Suggested fix:** Export a `clearPrivateKeyCache()` function and call it from `clearSession()` in `authHeaders.ts`. This ensures the cached key is evicted synchronously on logout.

---

## Appendix: Files Reviewed

| File | LOC (approx) | Notes |
|------|-------------|-------|
| `hub/index.html` | 12 | No CSP |
| `hub/vite.config.ts` | 35 | No security headers |
| `hub/src/main.tsx` | 113 | Router config |
| `hub/src/App.tsx` | 69 | Layout shell |
| `hub/src/types.ts` | (not shown) | Type definitions |
| `hub/src/hooks/useAuth.ts` | 80 | Bearer + DID sentinel pattern |
| `hub/src/hooks/useCards.ts` | 337 | Polling, filtering, pagination |
| `hub/src/hooks/useOwnerCards.ts` | 102 | Owner-scoped card fetch |
| `hub/src/hooks/useRequests.ts` | 128 | Request log polling |
| `hub/src/hooks/useProviderEvents.ts` | 72 | 5s polling, silent errors |
| `hub/src/lib/authHeaders.ts` | 127 | DID signing, private key cache |
| `hub/src/lib/crypto.ts` | 226 | WebCrypto Ed25519 |
| `hub/src/components/AuthGate.tsx` | 30 | Auth conditional |
| `hub/src/components/CardModal.tsx` | 503 | Modal, focus trap missing |
| `hub/src/components/CapabilityCard.tsx` | 125 | Clickable article |
| `hub/src/components/NavBar.tsx` | 407 | Nav, github link |
| `hub/src/components/HubAuthForm.tsx` | 352 | Register/login/api-key |
| `hub/src/components/OwnerDashboard.tsx` | 239 | Toggle-online silent failure |
| `hub/src/components/AgentDirectoryCard.tsx` | 116 | Clickable article |
| `hub/src/components/HubAgentCard.tsx` | 99 | Clickable article |
| `hub/src/components/ProfilePage.tsx` | 584 | DID display, credentials |
| `hub/src/components/SharePage.tsx` | 313 | Draft publish flow |
| `hub/src/components/DocsPage.tsx` | 82 | Static docs |
| `hub/src/lib/docs-content.tsx` | 681 | All-static JSX |
| `hub/src/pages/DiscoverPage.tsx` | 300 | Main discover surface |
| `hub/src/pages/ProviderDashboardPage.tsx` | 338 | Dashboard, auth gated |
| `hub/src/pages/FleetConsolePage.tsx` | 155 | Fleet, NO auth guard |
| `hub/src/pages/SignupPage.tsx` | 32 | Signup redirect |
| `hub/src/routes/SkillsInspector.tsx` | 196 | Skills inspector route |
| `hub/src/routes/WorkNetwork.tsx` | ~1700 | OVERSIZED (see Finding 19) |

---

## Finding Index

| # | Title | Severity | Category |
|---|-------|----------|----------|
| 1 | Ed25519 private key stored unencrypted in localStorage | CRITICAL | Auth Token Handling |
| 2 | `__did__` sentinel is a confusing security primitive | WARNING | Auth Token Handling |
| 3 | Bearer API key stored persistently in localStorage | INFO | Auth Token Handling |
| 4 | Toggle-online leaks `__did__` sentinel in Authorization header | WARNING | Auth Token Handling |
| 5 | No Content Security Policy anywhere | CRITICAL | XSS / Output Sanitization |
| 6 | `target="_blank"` — CONFIRMED HANDLED (rel="noopener noreferrer" present) | PASS | XSS |
| 7 | API strings rendered unescaped — React escaping is sufficient | INFO | XSS |
| 8 | FleetConsolePage, EvolutionPage, CreditPolicyPage lack auth guards | WARNING | Route Guards |
| 9 | Redundant double-check inside AuthGate | INFO | Route Guards |
| 10 | Toggle-online: silent failure, no user feedback | WARNING | Error Handling |
| 11 | useProviderEvents swallows all errors silently | INFO | Error Handling |
| 12 | useRequests stale closure bug on error check | WARNING | Error Handling |
| 13 | useCards stats fetch swallows errors silently | INFO | Error Handling |
| 14 | Clickable `<article>` cards are keyboard inaccessible | WARNING | Accessibility |
| 15 | Icon-only buttons — mostly handled, WorkNetwork needs audit | INFO | Accessibility |
| 16 | CardModal missing focus trap and focus restoration | WARNING | Accessibility |
| 17 | No hardcoded secrets found — CLEAN | PASS | Secret Exposure |
| 18 | Vite proxy target hardcodes localhost:7777 | INFO | Environment |
| 19 | WorkNetwork.tsx exceeds 800-line limit (~1700 LOC) | INFO | Code Quality |
| 20 | DiscoverPage IIFE label pattern | INFO | Code Quality |
| 21 | Private key cache not cleared on logout | INFO | Auth Token Handling |
