import { DEFAULT_USER_AGENT } from '@raisin/core';
import { describe, expect, it } from 'vitest';
import { parseConfigForm, presetFor, sanitizeOverrides, USER_AGENTS } from '../app/lib/config-form';
import { safeNext } from '../app/lib/safe-next';
import { nextRun } from '../app/lib/schedule-time';

describe('nextRun', () => {
  const from = new Date('2026-10-09T10:00:00Z'); // a Friday
  it('runs daily at the next occurrence of the hour', () => {
    expect(nextRun('daily', 3, from).toISOString()).toBe('2026-10-10T03:00:00.000Z');
    expect(nextRun('daily', 12, from).toISOString()).toBe('2026-10-09T12:00:00.000Z');
  });
  it('runs weekly on Mondays', () => {
    expect(nextRun('weekly', 3, from).toISOString()).toBe('2026-10-12T03:00:00.000Z');
  });
  it('runs monthly on the 1st', () => {
    expect(nextRun('monthly', 3, from).toISOString()).toBe('2026-11-01T03:00:00.000Z');
    expect(nextRun('monthly', 3, new Date('2026-11-01T01:00:00Z')).toISOString()).toBe(
      '2026-11-01T03:00:00.000Z',
    );
  });
});

describe('safeNext', () => {
  it.each([
    ['/app/crawls/x', '/app/crawls/x'],
    ['//evil.example', '/app'],
    ['/\\evil.example', '/app'],
    ['https://evil.example', '/app'],
    [null, '/app'],
  ])('%s → %s', (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});

describe('parseConfigForm', () => {
  it('maps form fields onto config overrides', () => {
    const form = new FormData();
    for (const [k, v] of Object.entries({
      maxUrls: '1000',
      maxDepth: '4',
      maxUrlsPerSecond: '3.5',
      userAgentPreset: 'googlebotDesktop',
      respectRobots: 'on',
      crawlImages: 'on',
      include: '/blog/\n[invalid',
      exclude: '\\?sort=',
      extractors: 'price | css | .price\nsku | regex | "sku":"([^"]+)"\nbad line',
      customHeaders: 'X-Test: 1\nnot a header',
      renderEnabled: 'on',
      waitUntil: 'load',
      aiSimilarity: 'on',
    })) {
      form.set(k, v);
    }
    const out = parseConfigForm(form);
    expect(out).toMatchObject({
      maxUrls: 1000,
      maxDepth: 4,
      maxUrlsPerSecond: 3.5,
      userAgent: USER_AGENTS.googlebotDesktop.value,
      respectRobots: true,
      respectNofollow: false,
      crawlImages: true,
      include: ['/blog/'],
      exclude: ['\\?sort='],
      customHeaders: { 'x-test': '1' },
      render: { enabled: true, waitUntil: 'load', screenshots: false },
      ai: { nearDuplicates: true },
    });
    expect(out.extractors).toEqual([
      { name: 'price', kind: 'css', selector: '.price' },
      { name: 'sku', kind: 'regex', selector: '"sku":"([^"]+)"' },
    ]);
  });

  it('falls back to RaisinBot for an empty custom user agent', () => {
    const form = new FormData();
    form.set('userAgentPreset', 'custom');
    expect(parseConfigForm(form).userAgent).toBe(DEFAULT_USER_AGENT);
    expect(presetFor(DEFAULT_USER_AGENT)).toBe('raisin');
    expect(presetFor('something else')).toBe('custom');
  });
});

describe('sanitizeOverrides', () => {
  it('keeps only allowed keys with valid types', () => {
    const out = sanitizeOverrides({
      maxUrls: 1500.7,
      maxDepth: 0,
      maxUrlsPerSecond: Number.NaN,
      requestTimeoutMs: 999_999_999,
      maxInFlight: 10_000,
      respectRobots: 'yes',
      crawlImages: false,
      include: ['/blog/', '[bad', 42],
      customHeaders: { Authorization: 'Bearer x', 'bad header': 'y', 'x-n': 5 },
      extractors: [
        { name: 'sku', kind: 'regex', selector: '"sku":"([^"]+)"' },
        { name: 'broken', kind: 'regex', selector: '(' },
        { name: 'js', kind: 'eval', selector: 'x' },
      ],
      render: { enabled: true, waitUntil: 'forever', timeoutMs: -1 },
      ai: { nearDuplicates: true },
    });
    expect(out).toEqual({
      maxUrls: 1500,
      maxDepth: 0,
      crawlImages: false,
      include: ['/blog/'],
      customHeaders: { authorization: 'Bearer x' },
      extractors: [{ name: 'sku', kind: 'regex', selector: '"sku":"([^"]+)"' }],
      render: { enabled: true },
      ai: { nearDuplicates: true },
    });
  });

  it('returns nothing for non-objects', () => {
    expect(sanitizeOverrides(null)).toEqual({});
    expect(sanitizeOverrides('maxUrls=10')).toEqual({});
    expect(sanitizeOverrides([1, 2])).toEqual({});
  });
});
