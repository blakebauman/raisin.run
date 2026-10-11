/**
 * Page-type grouping: turns a crawl's HTML pages into "340 product pages, 8 categories, 1 home
 * page". Two signals, both captured at ingest: the URL pattern (`urlPattern`) and the template
 * fingerprint (`PageData.templateSignature`, a MinHash of element structure). Pure, so it is tested
 * without a Durable Object; the Crawl DO feeds it rows and writes back the result.
 *
 *   1. Group pages by URL pattern.
 *   2. Split each group by template, so a pattern serving two layouts becomes two groups.
 *   3. Merge groups from different patterns that share a template (`/shoes/{slug}` and
 *      `/hats/{slug}` are both product pages).
 *
 * People can correct the result by naming URL patterns (`PageTypeNames`, kept per project). A named
 * pattern's pages skip steps 1–2 and join the type with that name, whatever their template, and
 * step 3 can still pull unnamed groups into a named type, so a new `/sale/{slug}` section joins
 * "Products" on the next crawl. Named types never merge with each other.
 *
 * Steps 2 and 3 are greedy: each page or group joins the first existing cluster whose
 * representative is close enough, else starts its own. Inputs are processed most important
 * first, so representatives are the pages and groups that matter most, and nothing chains: every
 * member is within the threshold of its representative, never just of another member.
 */

import { MINHASH_SLOTS } from './hash';

// Template similarity is the estimated Jaccard similarity of two pages' structural features. On
// a real catalogue site, pages of one template scored 0.8–1.0 (optional blocks such as "related
// products" make the difference) and different templates sharing the site's header and footer
// scored about 0.3. Both thresholds sit inside that gap.

/** Pages less similar than this to their pattern's representative split into a separate group. */
export const SPLIT_SIMILARITY = 0.6;
/** Groups from different patterns merge when their representatives are at least this similar. */
export const MERGE_SIMILARITY = 0.7;

export type PageTypeInput = {
  id: number;
  pattern: string;
  /** Template MinHash signature, as `minhash()` returns it. */
  template: string;
  /** Comma-separated structured data types, as stored in `pages.structured_types`. */
  structuredTypes: string | null;
  linkScore: number | null;
};

export type PageType = {
  /** 1-based, ordered by page count (largest first). */
  id: number;
  label: string;
  /** Every URL pattern in the type, largest first. */
  patterns: string[];
  sdType: string | null;
  pageIds: number[];
  /** The member with the highest Link Score. */
  sampleId: number;
};

/** URL pattern → the type name someone gave it. */
export type PageTypeNames = Record<string, string>;

type Signature = Uint16Array;

type Group = {
  pattern: string;
  rep: Signature;
  pages: PageTypeInput[];
};

type Cluster = { name: string | null; rep: Signature; groups: Group[] };

export function groupPageTypes(pages: PageTypeInput[], names: PageTypeNames = {}): PageType[] {
  const ordered = [...pages].sort(byImportance);

  // Named patterns: one cluster per name, its representative the most important member.
  const named = new Map<string, Cluster>();
  const byNamedPattern = new Map<string, Group>();
  for (const page of ordered) {
    const name = Object.hasOwn(names, page.pattern) ? names[page.pattern]!.trim() : '';
    if (!name) continue;
    let group = byNamedPattern.get(page.pattern);
    if (!group) {
      const signature = parseSignature(page.template);
      group = { pattern: page.pattern, rep: signature, pages: [] };
      byNamedPattern.set(page.pattern, group);
      const cluster = named.get(name);
      if (cluster) cluster.groups.push(group);
      else named.set(name, { name, rep: signature, groups: [group] });
    }
    group.pages.push(page);
  }

  // 1 + 2: by pattern, then by template within each pattern.
  const byPattern = new Map<string, Group[]>();
  for (const page of ordered) {
    if (byNamedPattern.has(page.pattern)) continue;
    const signature = parseSignature(page.template);
    const groups = byPattern.get(page.pattern) ?? [];
    const home = groups.find((g) => similarity(g.rep, signature) >= SPLIT_SIMILARITY);
    if (home) home.pages.push(page);
    else groups.push({ pattern: page.pattern, rep: signature, pages: [page] });
    byPattern.set(page.pattern, groups);
  }

  // 3: merge across patterns, biggest groups first so they become the representatives.
  const groups = [...byPattern.values()]
    .flat()
    .sort((a, b) => b.pages.length - a.pages.length || byImportance(a.pages[0]!, b.pages[0]!));
  const clusters: Cluster[] = [...named.values()];
  for (const group of groups) {
    const home = clusters.find((c) => similarity(c.rep, group.rep) >= MERGE_SIMILARITY);
    if (home) home.groups.push(group);
    else clusters.push({ name: null, rep: group.rep, groups: [group] });
  }

  return clusters
    .map((c) => describe(c.groups, c.name))
    .sort((a, b) => b.pageIds.length - a.pageIds.length || a.label.localeCompare(b.label))
    .map((t, i) => ({ ...t, id: i + 1 }));
}

function describe(groups: Group[], name: string | null): Omit<PageType, 'id'> {
  const counts = new Map<string, number>();
  for (const g of groups) counts.set(g.pattern, (counts.get(g.pattern) ?? 0) + g.pages.length);
  const patterns = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([p]) => p);
  const members = groups.flatMap((g) => g.pages).sort(byImportance);
  const sdType = dominantType(members);
  const extra = patterns.length > 1 ? ` (+${patterns.length - 1})` : '';
  return {
    label: name ?? `${sdType ? `${sdType} · ` : ''}${patterns[0]}${extra}`,
    patterns,
    sdType,
    pageIds: members.map((p) => p.id),
    sampleId: members[0]!.id,
  };
}

/** The structured data type on more than half the members, if any. */
function dominantType(pages: PageTypeInput[]): string | null {
  const counts = new Map<string, number>();
  for (const p of pages) {
    for (const t of new Set((p.structuredTypes ?? '').split(',').map((s) => s.trim()))) {
      if (t && t !== 'invalid') counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [t, n] of counts) {
    if (n > bestCount || (n === bestCount && best !== null && t < best)) {
      best = t;
      bestCount = n;
    }
  }
  return bestCount * 2 > pages.length ? best : null;
}

function byImportance(a: PageTypeInput, b: PageTypeInput): number {
  return (b.linkScore ?? 0) - (a.linkScore ?? 0) || a.id - b.id;
}

function parseSignature(hex: string): Signature {
  const out = new Uint16Array(MINHASH_SLOTS);
  for (let i = 0; i < MINHASH_SLOTS; i++) {
    out[i] = Number.parseInt(hex.slice(i * 4, i * 4 + 4), 16) || 0;
  }
  return out;
}

function similarity(a: Signature, b: Signature): number {
  let same = 0;
  for (let i = 0; i < MINHASH_SLOTS; i++) if (a[i] === b[i]) same++;
  return same / MINHASH_SLOTS;
}
