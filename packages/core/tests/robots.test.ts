import { describe, expect, it } from 'vitest';
import { isAllowed, parseRobots, robotsFromStatus, robotsToken } from '../src/robots';

const ROBOTS = `
# comment
User-agent: *
Disallow: /private/
Allow: /private/public-page
Disallow: /*.pdf$
Disallow: /search?
Crawl-delay: 2

User-agent: RaisinBot
User-agent: OtherBot
Disallow: /no-raisin/
Allow: /

User-agent: Googlebot
Disallow: /no-google/

Sitemap: https://example.com/sitemap.xml
Sitemap: https://example.com/news.xml
`;

const robots = parseRobots(ROBOTS);
const UA = 'Mozilla/5.0 (compatible; RaisinBot/1.0; +https://raisin.run/bot)';

describe('robots.txt', () => {
  it('extracts sitemaps', () => {
    expect(robots.sitemaps).toEqual([
      'https://example.com/sitemap.xml',
      'https://example.com/news.xml',
    ]);
  });

  it('derives the product token from a user agent', () => {
    expect(robotsToken(UA)).toBe('raisinbot');
    expect(robotsToken('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe('googlebot');
  });

  it('uses the most specific group instead of *', () => {
    expect(isAllowed(robots, 'https://example.com/private/x', UA).allowed).toBe(true);
    expect(isAllowed(robots, 'https://example.com/no-raisin/x', UA)).toMatchObject({
      allowed: false,
      rule: 'Disallow: /no-raisin/',
    });
  });

  it('falls back to * for unknown agents with longest-match and allow ties', () => {
    const ua = 'SomeCrawler/1.0';
    expect(isAllowed(robots, 'https://example.com/private/x', ua).allowed).toBe(false);
    expect(isAllowed(robots, 'https://example.com/private/public-page', ua).allowed).toBe(true);
    expect(isAllowed(robots, 'https://example.com/doc.pdf', ua).allowed).toBe(false);
    expect(isAllowed(robots, 'https://example.com/doc.pdf?x=1', ua).allowed).toBe(true);
    expect(isAllowed(robots, 'https://example.com/search?q=a', ua).allowed).toBe(false);
    expect(isAllowed(robots, 'https://example.com/search', ua).allowed).toBe(true);
    expect(isAllowed(robots, 'https://example.com/private/x', ua).crawlDelay).toBe(2);
  });

  it('always allows /robots.txt', () => {
    const all = parseRobots('User-agent: *\nDisallow: /');
    expect(isAllowed(all, 'https://example.com/robots.txt', UA).allowed).toBe(true);
    expect(isAllowed(all, 'https://example.com/', UA).allowed).toBe(false);
  });

  it('maps fetch status per RFC 9309', () => {
    expect(isAllowed(robotsFromStatus(404, ''), 'https://e.com/x', UA).allowed).toBe(true);
    expect(isAllowed(robotsFromStatus(503, ''), 'https://e.com/x', UA).allowed).toBe(false);
  });

  it('treats an empty Disallow as allow-all', () => {
    expect(isAllowed(parseRobots('User-agent: *\nDisallow:'), 'https://e.com/x', UA).allowed).toBe(
      true,
    );
  });
});
