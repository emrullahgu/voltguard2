import { onPortalReset } from './api';

const activeReads = new Map<string, Promise<unknown>>();
onPortalReset(() => activeReads.clear());

// Share only a currently running read/hydration. Completed results and failed
// payloads are never retained, retried, or used to coalesce business mutations.
export function coalescePortalRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  const active = activeReads.get(key);
  if (active) return active as Promise<T>;
  const request = Promise.resolve().then(read).finally(() => {
    if (activeReads.get(key) === request) activeReads.delete(key);
  });
  activeReads.set(key, request);
  return request;
}
