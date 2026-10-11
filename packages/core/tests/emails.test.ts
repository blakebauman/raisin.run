import { describe, expect, it } from 'vitest';
import { crawlFinishedEmail, invitationEmail, parseSender } from '../src/emails';

describe('emails', () => {
  it('builds an invitation with escaped HTML and a plain-text twin', () => {
    const mail = invitationEmail({
      orgName: 'Acme <Search>',
      inviterName: 'Jo "JJ" Doe',
      role: 'admin',
      link: 'https://raisin.run/invite/abc',
    });
    expect(mail.subject).toBe('Jo "JJ" Doe invited you to Acme <Search> on Raisin');
    expect(mail.html).toContain('Acme &lt;Search&gt;');
    expect(mail.html).not.toContain('<Search>');
    expect(mail.html).toContain('href="https://raisin.run/invite/abc"');
    expect(mail.text).toContain('as an admin');
    expect(mail.text).toContain('https://raisin.run/invite/abc');
  });

  it('summarises a finished crawl, with the change against the previous one when known', () => {
    const base = {
      projectName: 'Example',
      startUrl: 'https://example.com/',
      crawled: 1234,
      totals: { issue: 1, warning: 20, opportunity: 300 },
      link: 'https://raisin.run/app/crawls/c1',
    };
    const first = crawlFinishedEmail({ ...base, change: null });
    expect(first.subject).toBe('Crawl finished: Example — 1 issue');
    expect(first.text).toContain('1,234 URLs');
    expect(first.text).not.toContain('Since the last crawl');
    const again = crawlFinishedEmail({
      ...base,
      totals: { ...base.totals, issue: 3 },
      change: { new: 5, fixed: 2 },
    });
    expect(again.subject).toBe('Crawl finished: Example — 3 issues');
    expect(again.text).toContain('Since the last crawl: 5 new, 2 fixed.');
  });

  it('parses sender addresses', () => {
    expect(parseSender('Raisin <notifications@raisin.run>')).toEqual({
      name: 'Raisin',
      email: 'notifications@raisin.run',
    });
    expect(parseSender(' ops@raisin.run ')).toBe('ops@raisin.run');
    expect(parseSender('')).toBeNull();
    expect(parseSender('not an address')).toBeNull();
  });
});
