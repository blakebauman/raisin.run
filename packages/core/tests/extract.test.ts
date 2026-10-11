import { describe, expect, it } from 'vitest';
import { extractPage } from '../src/extract';
import { hammingDistance } from '../src/hash';
import { ARTICLE } from './fixtures';

describe('extractPage', async () => {
  const page = await extractPage(ARTICLE, 'https://example.com/guide/', {
    keepText: true,
    extractors: [
      { name: 'author', kind: 'regex', selector: '"author":"([^"]+)"' },
      { name: 'product', kind: 'css', selector: '[itemprop="name"]' },
    ],
  });

  it('reads head metadata and decodes entities', () => {
    expect(page.titles).toEqual(['Fish & Chips — The Complete Guide']);
    expect(page.metaDescriptions).toEqual(['Everything about fish & chips.']);
    expect(page.metaRobots).toEqual(['index, follow']);
    expect(page.lang).toBe('en-GB');
    expect(page.charset).toBe('utf-8');
    expect(page.canonicals).toEqual(['/guide/']);
    expect(page.relNext).toBe('/guide/page/2/');
    expect(page.openGraph['og:title']).toBe('Fish and chips');
  });

  it('ignores svg <title> elements', () => {
    expect(page.titles).toHaveLength(1);
  });

  it('collects headings in document order', () => {
    expect(page.h1).toEqual(['Fish & chips']);
    expect(page.h2).toEqual(['History']);
    expect(page.headingOrder).toEqual([1, 3, 2]);
  });

  it('collects hreflang annotations', () => {
    expect(page.hreflang.map((h) => h.lang)).toEqual(['en-gb', 'fr', 'english']);
  });

  it('collects anchors with text, rel, position and image alt', () => {
    const anchors = page.links.filter((l) => l.type === 'a');
    expect(anchors.map((a) => a.href)).toEqual([
      '/',
      '/about',
      '/history',
      'https://other.example.org/page',
      'mailto:a@b.c',
      '/gallery',
      '/privacy',
    ]);
    expect(anchors[1]).toMatchObject({ anchor: 'About us'.replace(' ', ' '), position: 'nav' });
    expect(anchors[2]).toMatchObject({
      anchor: 'click here',
      rel: 'nofollow',
      position: 'content',
    });
    expect(anchors[5]).toMatchObject({ anchor: '', alt: 'A battered cod' });
    expect(anchors[6]).toMatchObject({ position: 'footer' });
  });

  it('collects images, distinguishing missing alt from empty alt', () => {
    expect(page.images).toEqual([
      { src: '/img/cod.jpg', alt: 'A battered cod', width: null, height: null },
      { src: '/img/no-alt.png', alt: null, width: '10', height: null },
      { src: '/img/lazy.webp', alt: '', width: null, height: null },
    ]);
  });

  it('flags mixed content and insecure forms on https pages', () => {
    expect(page.mixedContent).toEqual(['http://cdn.example.net/site.css']);
    expect(page.insecureForms).toBe(1);
  });

  it('validates JSON-LD and records microdata', () => {
    const jsonLd = page.structuredData.find((b) => b.format === 'json-ld');
    expect(jsonLd).toMatchObject({ types: ['Article'], valid: false });
    expect(jsonLd?.errors).toEqual(['Article: missing required property "headline"']);
    expect(page.structuredData.find((b) => b.format === 'microdata')?.types).toEqual(['Product']);
  });

  it('counts only visible text', () => {
    expect(page.text).not.toContain('not text');
    expect(page.text).not.toContain('display: none');
    expect(page.text).not.toContain('icon title');
    expect(page.text).toContain('Fried fish with chips is a hot dish.');
    expect(page.wordCount).toBeGreaterThan(20);
    expect(page.contentHash).toMatch(/^[0-9a-f]{24}$/);
    expect(page.simhash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('runs custom extractors', () => {
    expect(page.extractions.author).toEqual(['Me']);
    expect(page.extractions.product).toEqual(['Cod']);
  });
});

describe('template fingerprint', async () => {
  const product = (name: string, extra: string, cards: number) => `<!doctype html>
<html><head><title>${name}</title></head><body>
<header class="site-header"><nav class="nav"><a href="/">Home</a><a href="/shop">Shop</a></nav></header>
<main class="product layout">
  <h1 class="product-title">${name}</h1>
  <div class="gallery"><img src="/${name}.jpg" alt=""></div>
  <section class="details"><p>${extra}</p><button class="btn buy">Add to basket</button></section>
  <ul class="related">${'<li class="card"><a href="/x">Related</a></li>'.repeat(cards)}</ul>
</main>
<footer class="site-footer"><p>© Shop</p></footer>
</body></html>`;
  const article = `<!doctype html>
<html><head><title>Story</title></head><body>
<div class="wrapper"><article class="post"><h1>Story</h1><time>today</time>
<div class="post-body"><p>One</p><p>Two</p><blockquote>Three</blockquote><figure><img src="/a.jpg"><figcaption>Cap</figcaption></figure></div>
<aside class="author-bio"><h3>Author</h3></aside></article></div>
<form class="newsletter"><input name="email"><button>Join</button></form>
</body></html>`;

  const url = 'https://e.com/p/';
  const a = await extractPage(product('cod', 'Fresh fish, caught today.', 3), url);
  const b = await extractPage(
    product('haddock', 'Smoked haddock with a much longer description of its origin.', 12),
    url,
  );
  const c = await extractPage(article, url);
  const withBadge = await extractPage(
    product('cod', 'x', 3).replace('<h1', '<span class="badge sale">Sale</span><h1'),
    url,
  );

  it('is a 64-bit hex simhash', () => {
    expect(a.templateHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('ignores text and repeated elements', () => {
    expect(a.templateHash).toBe(b.templateHash);
  });

  it('stays close when a template varies slightly', () => {
    expect(hammingDistance(a.templateHash, withBadge.templateHash)).toBeLessThanOrEqual(8);
  });

  it('separates different templates', () => {
    expect(hammingDistance(a.templateHash, c.templateHash)).toBeGreaterThan(12);
  });
});
