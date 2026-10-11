/**
 * Target safety. Workers cannot reach private networks, but a hostile crawl config could still
 * aim RaisinBot at loopback names, cloud metadata hosts or non-web ports on the public Internet.
 * Every start URL is checked here, and the fetcher checks every URL again before requesting it.
 */

const BLOCKED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.intranet',
  '.lan',
  '.home.arpa',
  '.corp',
];
const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
  'instance-data',
]);

export type TargetCheck = { ok: true } | { ok: false; reason: string };

export function checkTarget(input: string, allowedPorts: number[] = []): TargetCheck {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: 'Not a valid URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'Only http and https URLs can be crawled' };
  }
  if (url.username || url.password) {
    return {
      ok: false,
      reason: 'Credentials in the URL are not allowed; use crawl authentication',
    };
  }
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: 'Private or internal hostnames cannot be crawled' };
  }
  if (isIpLiteral(host)) {
    return { ok: false, reason: 'IP addresses cannot be crawled; use a hostname' };
  }
  if (!host.includes('.')) {
    return { ok: false, reason: 'Hostname must be fully qualified' };
  }
  if (url.port && !allowedPorts.includes(Number(url.port))) {
    return { ok: false, reason: `Port ${url.port} is not allowed` };
  }
  return { ok: true };
}

function isIpLiteral(host: string): boolean {
  if (host.startsWith('[')) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true;
  // Decimal, hex and octal IPv4 spellings (`2130706433`, `0x7f000001`) that URL parsers accept.
  return /^(?:0x[0-9a-f]+|\d+)$/i.test(host);
}
