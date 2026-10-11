/**
 * Structured data checks. Full schema.org validation is phase 2; v1 checks that JSON-LD parses,
 * collects every `@type` (including inside `@graph`), and flags missing properties that Google
 * requires for the common rich-result types.
 */

import type { StructuredDataBlock } from './types';

/** Required properties per Google's rich-result documentation for the most common types. */
const REQUIRED: Record<string, string[]> = {
  Article: ['headline'],
  NewsArticle: ['headline'],
  BlogPosting: ['headline'],
  Product: ['name'],
  Offer: ['price', 'priceCurrency'],
  BreadcrumbList: ['itemListElement'],
  FAQPage: ['mainEntity'],
  Question: ['name', 'acceptedAnswer'],
  Recipe: ['name', 'image'],
  Event: ['name', 'startDate', 'location'],
  Organization: ['name'],
  LocalBusiness: ['name', 'address'],
  Review: ['itemReviewed', 'reviewRating', 'author'],
  AggregateRating: ['ratingValue'],
  VideoObject: ['name', 'thumbnailUrl', 'uploadDate'],
  JobPosting: ['title', 'description', 'datePosted', 'hiringOrganization'],
  HowTo: ['name', 'step'],
  SoftwareApplication: ['name'],
  Course: ['name', 'description'],
};

type Node = Record<string, unknown>;

const MAX_RAW = 4_000;

export function checkJsonLd(raw: string): StructuredDataBlock {
  const block: StructuredDataBlock = {
    format: 'json-ld',
    types: [],
    valid: true,
    errors: [],
    raw: raw.slice(0, MAX_RAW),
  };
  let data: unknown;
  try {
    data = JSON.parse(raw.trim());
  } catch (e) {
    block.valid = false;
    block.errors.push(`JSON parse error: ${e instanceof Error ? e.message : String(e)}`);
    return block;
  }
  const seen = new Set<string>();
  walk(data, (node) => {
    const types = typesOf(node);
    for (const type of types) {
      seen.add(type);
      for (const prop of REQUIRED[type] ?? []) {
        if (node[prop] === undefined || node[prop] === null || node[prop] === '') {
          block.errors.push(`${type}: missing required property "${prop}"`);
        }
      }
    }
  });
  block.types = [...seen];
  if (block.types.length === 0) block.errors.push('No @type found');
  block.valid = block.errors.length === 0;
  return block;
}

function typesOf(node: Node): string[] {
  const t = node['@type'];
  const list = Array.isArray(t) ? t : t === undefined ? [] : [t];
  return list
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.replace(/^https?:\/\/schema\.org\//, ''));
}

function walk(value: unknown, visit: (node: Node) => void, depth = 0): void {
  if (depth > 12 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, depth + 1);
    return;
  }
  const node = value as Node;
  visit(node);
  for (const [key, child] of Object.entries(node)) {
    if (key !== '@context') walk(child, visit, depth + 1);
  }
}
