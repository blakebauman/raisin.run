import { describe, expect, it } from 'vitest';
import { checkTarget } from '../src/safety';
import { isInternal, normalizeUrl, resolveUrl, scopeFor, urlId, urlPattern } from '../src/url';

describe('normalizeUrl', () => {
  it.each([
    ['HTTPS://Example.COM:443/a?b=1#frag', 'https://example.com/a?b=1'],
    ['http://example.com:80', 'http://example.com/'],
    ['https://example.com./x/../y', 'https://example.com/y'],
    ['https://example.com/a?', 'https://example.com/a'],
    ['https://example.com/Path', 'https://example.com/Path'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeUrl(input)).toBe(expected);
  });

  it('rejects non-web schemes', () => {
    expect(normalizeUrl('ftp://example.com/')).toBeNull();
  });
});

describe('resolveUrl', () => {
  it('resolves relative links and drops uncrawlable ones', () => {
    expect(resolveUrl('../b', 'https://example.com/a/c')).toBe('https://example.com/b');
    expect(resolveUrl('#top', 'https://example.com/')).toBeNull();
    expect(resolveUrl('javascript:void(0)', 'https://example.com/')).toBeNull();
    expect(resolveUrl('tel:123', 'https://example.com/')).toBeNull();
    expect(resolveUrl('  /x  ', 'https://example.com/')).toBe('https://example.com/x');
  });
});

describe('urlId', () => {
  it('is stable, safe-integer and spelling-insensitive through normalisation', () => {
    const a = urlId(normalizeUrl('https://EXAMPLE.com/a#x')!);
    const b = urlId(normalizeUrl('https://example.com:443/a')!);
    expect(a).toBe(b);
    expect(Number.isSafeInteger(a)).toBe(true);
    expect(urlId('https://example.com/b')).not.toBe(a);
  });
});

describe('isInternal', () => {
  const scope = scopeFor('https://www.example.com/', false);
  it('treats www and bare host as the same site', () => {
    expect(isInternal('https://example.com/a', scope)).toBe(true);
    expect(isInternal('http://www.example.com/a', scope)).toBe(true);
  });
  it('excludes subdomains unless enabled', () => {
    expect(isInternal('https://blog.example.com/', scope)).toBe(false);
    expect(
      isInternal('https://blog.example.com/', scopeFor('https://www.example.com/', true)),
    ).toBe(true);
    expect(isInternal('https://example.org/', scopeFor('https://www.example.com/', true))).toBe(
      false,
    );
  });
});

describe('checkTarget', () => {
  it.each([
    ['https://example.com/', true],
    ['http://localhost/', false],
    ['http://127.0.0.1/', false],
    ['http://[::1]/', false],
    ['http://2130706433/', false],
    ['http://db.internal/', false],
    ['https://example.com:8443/', false],
    ['https://user:pw@example.com/', false],
    ['file:///etc/passwd', false],
    ['http://intranet/', false],
  ])('%s → ok=%s', (url, ok) => {
    expect(checkTarget(url).ok).toBe(ok);
  });
  it('allows explicitly permitted ports', () => {
    expect(checkTarget('https://example.com:8443/', [8443]).ok).toBe(true);
  });
});

describe('urlPattern', () => {
  it.each([
    ['https://e.com/', '/'],
    ['https://e.com/about', '/about'],
    ['https://e.com/products/blue-widget', '/products/{slug}'],
    ['https://e.com/products/blue-widget-42/', '/products/{slug}/'],
    ['https://e.com/Products/shoes', '/products/shoes'],
    ['https://e.com/blog/2026/10/my-first-post.html', '/blog/{n}/{n}/{slug}.html'],
    ['https://e.com/news/2026-10-09/launch', '/news/{date}/launch'],
    ['https://e.com/order/3f2a1b9c-0d4e-4f5a-8b6c-7d8e9f0a1b2c', '/order/{id}'],
    ['https://e.com/p/sku12345', '/p/{slug}'],
    ['https://e.com/api/v2/docs', '/api/v2/docs'],
    ['https://e.com/a-very-long-category-name/x', '/{slug}/x'],
    ['https://e.com/search?q=shoes&utm_source=x&page=2', '/search?page&q'],
    ['https://e.com/caf%C3%A9-cr%C3%A8me', '/{slug}'],
  ])('%s → %s', (input, expected) => {
    expect(urlPattern(input)).toBe(expected);
  });

  it('returns null for unparseable input', () => {
    expect(urlPattern('not a url')).toBeNull();
  });
});
