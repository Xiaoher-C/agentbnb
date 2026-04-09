/**
 * withTimeout — race a promise against a timer.
 *
 * Used to put a hard upper bound on best-effort operations (e.g. registry
 * credit grants during `init`) so they cannot block the main flow longer
 * than the caller is willing to wait.
 *
 * On timeout, the wrapped promise is **not** cancelled — only the wait is
 * abandoned. Callers that need cancellation must thread an AbortController
 * into the underlying operation.
 */

/** Thrown when withTimeout's deadline elapses before the promise settles. */
export class TimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Operation timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Resolves with the wrapped promise's result, or rejects with TimeoutError
 * after `timeoutMs` milliseconds — whichever happens first.
 */
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(timeoutMs)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
