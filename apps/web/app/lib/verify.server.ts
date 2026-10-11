/**
 * Domain verification, one of three ways: a DNS TXT record at `_raisin-verify.<host>`, a
 * `<meta name="raisin-verification">` tag on the start URL, or a file at
 * `/.well-known/raisin-verify.txt`. Each must contain the project's token.
 */

import { DEFAULT_USER_AGENT } from '@raisin/core';
import { projects } from '@raisin/db';
import { eq } from 'drizzle-orm';
import type { Project } from './crawls.server';
import { db } from './env.server';

export type VerifyMethod = 'dns' | 'meta' | 'file';

export function verificationInstructions(project: Project) {
  const origin = new URL(project.startUrl).origin;
  return {
    dns: {
      name: `_raisin-verify.${project.host}`,
      value: `raisin-verification=${project.verificationToken}`,
    },
    meta: `<meta name="raisin-verification" content="${project.verificationToken}">`,
    file: { url: `${origin}/.well-known/raisin-verify.txt`, content: project.verificationToken },
  };
}

export async function verifyProject(project: Project): Promise<VerifyMethod | null> {
  const checks: [VerifyMethod, () => Promise<boolean>][] = [
    ['dns', () => checkDns(project)],
    ['meta', () => checkMeta(project)],
    ['file', () => checkFile(project)],
  ];
  for (const [method, check] of checks) {
    if (await check().catch(() => false)) {
      await db()
        .update(projects)
        .set({ verifiedAt: new Date(), verifiedMethod: method })
        .where(eq(projects.id, project.id));
      return method;
    }
  }
  return null;
}

async function checkDns(project: Project): Promise<boolean> {
  const name = `_raisin-verify.${project.host}`;
  const res = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`,
    {
      headers: { accept: 'application/dns-json' },
    },
  );
  const out = (await res.json()) as { Answer?: { data: string }[] };
  return (out.Answer ?? []).some((a) =>
    a.data.replace(/"/g, '').includes(project.verificationToken),
  );
}

async function checkMeta(project: Project): Promise<boolean> {
  const res = await fetchOnHost(project.startUrl, project.host);
  if (!res?.ok) return false;
  const html = (await res.text()).slice(0, 200_000);
  const re = /<meta[^>]+name=["']raisin-verification["'][^>]*>/gi;
  return [...html.matchAll(re)].some((m) => m[0].includes(project.verificationToken));
}

async function checkFile(project: Project): Promise<boolean> {
  const url = `${new URL(project.startUrl).origin}/.well-known/raisin-verify.txt`;
  const res = await fetchOnHost(url, project.host);
  return Boolean(res?.ok) && (await res!.text()).includes(project.verificationToken);
}

/**
 * Fetch, following redirects only while they stay on `host`. Following them anywhere would let an
 * open redirect on someone else's site "verify" it with a token served from the attacker's host.
 */
async function fetchOnHost(url: string, host: string, hops = 5): Promise<Response | null> {
  let current = url;
  for (let i = 0; i <= hops; i++) {
    if (new URL(current).hostname !== host) return null;
    const res = await fetch(current, {
      headers: { 'user-agent': DEFAULT_USER_AGENT },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    const location = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !location) return res;
    await res.body?.cancel();
    current = new URL(location, current).toString();
  }
  return null;
}
