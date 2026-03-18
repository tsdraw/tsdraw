const SESSION_STORAGE_KEY = 'TSDRAW_TAB_SESSION_ID_v1';

function createSessionId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `tsdraw-session-${timestamp}-${randomPart}`;
}

export function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') return createSessionId();

  const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (existing) return existing;

  const newId = createSessionId();
  window.sessionStorage.setItem(SESSION_STORAGE_KEY, newId);
  return newId;
}
