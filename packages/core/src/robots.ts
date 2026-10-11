/**
 * robots.txt parsing and matching per RFC 9309 / Google's documented behaviour:
 * - groups start with one or more `user-agent` lines, and groups naming the same agent merge;
 * - the most specific matching user-agent group wins, otherwise `*`, otherwise allow-all;
 * - the longest matching rule wins, and on a tie `allow` beats `disallow`;
 * - `*` matches any run of characters and a trailing `$` anchors the end;
 * - `/robots.txt` itself is always allowed.
 */

export type RobotsRule = { allow: boolean; pattern: string; re: RegExp; length: number };

export type RobotsGroup = { agents: string[]; rules: RobotsRule[]; crawlDelay: number | null };

export type Robots = { groups: RobotsGroup[]; sitemaps: string[] };

export type RobotsVerdict = { allowed: boolean; rule: string | null; crawlDelay: number | null };

/** Google ignores everything after the first 500 KiB. */
const MAX_BYTES = 500 * 1024;

export function parseRobots(body: string): Robots {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;

  for (const rawLine of body.slice(0, MAX_BYTES).split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    switch (key) {
      case 'user-agent':
      case 'useragent':
      case 'user agent': {
        if (!current || !lastWasAgent) {
          current = { agents: [], rules: [], crawlDelay: null };
          groups.push(current);
        }
        current.agents.push(value.toLowerCase());
        lastWasAgent = true;
        continue;
      }
      case 'allow':
      case 'disallow': {
        if (current) {
          // An empty `disallow:` means "allow everything" and adds no rule.
          if (value) current.rules.push(compileRule(key === 'allow', value));
        }
        break;
      }
      case 'crawl-delay': {
        const n = Number.parseFloat(value);
        if (current && Number.isFinite(n) && n >= 0) current.crawlDelay = n;
        break;
      }
      case 'sitemap':
      case 'site-map': {
        if (value) sitemaps.push(value);
        break;
      }
    }
    lastWasAgent = false;
  }
  return { groups, sitemaps };
}

function compileRule(allow: boolean, pattern: string): RobotsRule {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body
    .split('*')
    .map((part) => escapeRegExp(normalizeRobotsPath(part)))
    .join('.*');
  return {
    allow,
    pattern,
    re: new RegExp(`^${source}${anchored ? '$' : ''}`),
    length: pattern.length,
  };
}

/** Match percent-encoding case-insensitively by uppercasing escapes on both sides. */
function normalizeRobotsPath(path: string): string {
  return path.replace(/%[0-9a-f]{2}/gi, (m) => m.toUpperCase());
}

function escapeRegExp(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/** The product token RaisinBot matches groups with, e.g. `raisinbot` or `googlebot`. */
export function robotsToken(userAgent: string): string {
  const bot = userAgent.match(/([a-z0-9_-]*bot[a-z0-9_-]*)/i);
  if (bot?.[1]) return bot[1].toLowerCase();
  const first = userAgent.match(/^([a-z0-9_-]+)/i);
  return first?.[1]?.toLowerCase() ?? '*';
}

function selectRules(
  robots: Robots,
  token: string,
): { rules: RobotsRule[]; crawlDelay: number | null } {
  let best = -1;
  let rules: RobotsRule[] = [];
  let crawlDelay: number | null = null;
  for (const group of robots.groups) {
    for (const agent of group.agents) {
      if (agent === '*' || !token.includes(agent)) continue;
      if (agent.length > best) {
        best = agent.length;
        rules = [...group.rules];
        crawlDelay = group.crawlDelay;
      } else if (agent.length === best) {
        rules.push(...group.rules);
        crawlDelay ??= group.crawlDelay;
      }
    }
  }
  if (best >= 0) return { rules, crawlDelay };
  for (const group of robots.groups) {
    if (group.agents.includes('*')) {
      rules.push(...group.rules);
      crawlDelay ??= group.crawlDelay;
    }
  }
  return { rules, crawlDelay };
}

export function isAllowed(robots: Robots, url: string, userAgent: string): RobotsVerdict {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { allowed: false, rule: null, crawlDelay: null };
  }
  const path = normalizeRobotsPath(target.pathname + target.search);
  const { rules, crawlDelay } = selectRules(robots, robotsToken(userAgent));
  if (target.pathname === '/robots.txt') return { allowed: true, rule: null, crawlDelay };

  let winner: RobotsRule | null = null;
  for (const rule of rules) {
    if (!rule.re.test(path)) continue;
    if (
      !winner ||
      rule.length > winner.length ||
      (rule.length === winner.length && rule.allow && !winner.allow)
    ) {
      winner = rule;
    }
  }
  return {
    allowed: winner ? winner.allow : true,
    rule: winner ? `${winner.allow ? 'Allow' : 'Disallow'}: ${winner.pattern}` : null,
    crawlDelay,
  };
}

/**
 * How a robots.txt fetch outcome maps to crawl permission (RFC 9309 §2.3.1):
 * 4xx means no restrictions, 5xx or a network error means disallow everything.
 */
export function robotsFromStatus(status: number, body: string): Robots {
  if (status >= 200 && status < 300) return parseRobots(body);
  if (status >= 400 && status < 500) return { groups: [], sitemaps: [] };
  return {
    groups: [{ agents: ['*'], rules: [compileRule(false, '/')], crawlDelay: null }],
    sitemaps: [],
  };
}

/** Serialisable form for the KV cache; regexes are rebuilt on read. */
export type RobotsSnapshot = { status: number; body: string; fetchedAt: number };
