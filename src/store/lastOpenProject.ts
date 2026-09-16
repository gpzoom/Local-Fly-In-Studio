const LAST_OPEN_PROJECT_KEY = 'local-fly-in-studio:last-open-project-id';

export function getLastOpenProjectId(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(LAST_OPEN_PROJECT_KEY);
  } catch {
    return null;
  }
}

export function setLastOpenProjectId(id: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LAST_OPEN_PROJECT_KEY, id);
  } catch {
    // Ignore storage failures (private browsing, quota, etc.) — this is a convenience only.
  }
}
