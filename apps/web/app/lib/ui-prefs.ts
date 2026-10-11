/**
 * Layout preferences (collapsed sidebar, issues panel, hidden grid columns) live in cookies so
 * the server renders the layout the viewer left, without a flash on hydration. They are
 * presentation only and never authorise anything.
 */

export const PREFS = {
  sidebar: 'raisin-sidebar',
  issuesPanel: 'raisin-issues-panel',
  columns: 'raisin-columns',
} as const;

type PrefName = (typeof PREFS)[keyof typeof PREFS];

export function readPref(request: Request, name: PrefName): string | null {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) {
      try {
        return decodeURIComponent(v.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Client only. A year is long enough that the layout feels remembered. */
export function writePref(name: PrefName, value: string): void {
  // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is missing from older Safari, and this write is fire-and-forget.
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
}

/** Hidden column keys per tab, from the columns cookie. Unknown shapes read as nothing hidden. */
export function parseHiddenColumns(raw: string | null): Record<string, string[]> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Record<string, string[]> = {};
    for (const [tab, keys] of Object.entries(value))
      if (Array.isArray(keys)) out[tab] = keys.filter((k): k is string => typeof k === 'string');
    return out;
  } catch {
    return {};
  }
}
