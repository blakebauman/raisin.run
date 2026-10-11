import { describe, expect, it } from 'vitest';
import { groupPageTypes, type PageTypeInput } from '../src/page-types';

/** A 64-slot signature: slot i holds `base + i`, except the first `changed` slots. */
const signature = (base: number, changed = 0) =>
  Array.from({ length: 64 }, (_, i) =>
    (i < changed ? 0xf000 + i : base + i).toString(16).padStart(4, '0'),
  ).join('');

const PRODUCT = signature(0x100);
const PRODUCT_VARIANT = signature(0x100, 10); // similarity 54/64 ≈ 0.84
const STUB = signature(0x100, 30); // similarity 34/64 ≈ 0.53: same pattern, different template
const ARTICLE = signature(0x800);

let nextId = 1;
const page = (
  pattern: string,
  template: string,
  extra: Partial<PageTypeInput> = {},
): PageTypeInput => ({
  id: nextId++,
  pattern,
  template,
  structuredTypes: null,
  linkScore: null,
  ...extra,
});

describe('groupPageTypes', () => {
  it('merges patterns that share a template, largest type first', () => {
    const types = groupPageTypes([
      page('/shoes/{slug}', PRODUCT, { structuredTypes: 'Product' }),
      page('/shoes/{slug}', PRODUCT_VARIANT, { structuredTypes: 'Product, BreadcrumbList' }),
      page('/hats/{slug}', PRODUCT, { structuredTypes: 'Product' }),
      page('/journal/{slug}', ARTICLE, { structuredTypes: 'Article' }),
    ]);
    expect(types.map((t) => [t.id, t.label, t.patterns, t.pageIds.length])).toEqual([
      [1, 'Product · /shoes/{slug} (+1)', ['/shoes/{slug}', '/hats/{slug}'], 3],
      [2, 'Article · /journal/{slug}', ['/journal/{slug}'], 1],
    ]);
  });

  it('splits one pattern serving two templates', () => {
    const types = groupPageTypes([
      page('/p/{slug}', PRODUCT),
      page('/p/{slug}', PRODUCT),
      page('/p/{slug}', STUB),
    ]);
    expect(types.map((t) => t.pageIds.length)).toEqual([2, 1]);
    expect(types.every((t) => t.label === '/p/{slug}')).toBe(true);
  });

  it('samples the page with the highest Link Score', () => {
    const low = page('/a/{slug}', PRODUCT, { linkScore: 10 });
    const high = page('/a/{slug}', PRODUCT, { linkScore: 90 });
    const [type] = groupPageTypes([low, high]);
    expect(type!.sampleId).toBe(high.id);
    expect(type!.pageIds).toEqual([high.id, low.id]);
  });

  it('only names a structured data type most pages carry', () => {
    const [type] = groupPageTypes([
      page('/x/{slug}', PRODUCT, { structuredTypes: 'Product' }),
      page('/x/{slug}', PRODUCT),
      page('/x/{slug}', PRODUCT, { structuredTypes: 'invalid' }),
    ]);
    expect(type!.sdType).toBeNull();
  });

  describe('with names', () => {
    it('labels a named pattern with its name, whatever its templates', () => {
      const types = groupPageTypes(
        [page('/p/{slug}', PRODUCT), page('/p/{slug}', STUB), page('/journal/{slug}', ARTICLE)],
        { '/p/{slug}': 'Products' },
      );
      expect(types.map((t) => [t.label, t.pageIds.length])).toEqual([
        ['Products', 2],
        ['/journal/{slug}', 1],
      ]);
    });

    it('merges patterns given the same name and keeps differently named ones apart', () => {
      const types = groupPageTypes(
        [
          page('/shoes/{slug}', PRODUCT),
          page('/hats/{slug}', PRODUCT),
          page('/journal/{slug}', ARTICLE),
          page('/news/{slug}', ARTICLE),
        ],
        {
          '/shoes/{slug}': 'Shoes',
          '/hats/{slug}': 'Hats',
          '/journal/{slug}': 'Stories',
          '/news/{slug}': 'Stories',
        },
      );
      expect(types.map((t) => [t.label, t.patterns])).toEqual([
        ['Stories', ['/journal/{slug}', '/news/{slug}']],
        ['Hats', ['/hats/{slug}']],
        ['Shoes', ['/shoes/{slug}']],
      ]);
    });

    it('lets an unnamed pattern with the same template join a named type', () => {
      const types = groupPageTypes(
        [page('/shoes/{slug}', PRODUCT), page('/sale/{slug}', PRODUCT_VARIANT)],
        { '/shoes/{slug}': 'Products' },
      );
      expect(types.map((t) => [t.label, t.patterns])).toEqual([
        ['Products', ['/sale/{slug}', '/shoes/{slug}']],
      ]);
    });

    it('ignores blank names and names for patterns not in the crawl', () => {
      const types = groupPageTypes([page('/a/{slug}', PRODUCT)], {
        '/a/{slug}': '  ',
        '/gone/{slug}': 'Gone',
      });
      expect(types.map((t) => t.label)).toEqual(['/a/{slug}']);
    });
  });

  it('returns nothing for no pages', () => {
    expect(groupPageTypes([])).toEqual([]);
  });
});
