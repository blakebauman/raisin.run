import { DEFAULT_USER_AGENT } from '@raisin/core';
import { Link } from 'react-router';
import { Logo } from '~/components/common';
import type { Route } from './+types/bot';

export function meta(): Route.MetaDescriptors {
  return [{ title: 'RaisinBot — the Raisin crawler' }];
}

export default function Bot() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Link to="/" aria-label="Raisin home" className="inline-block rounded-md">
        <Logo />
      </Link>
      <h1 className="mt-10 text-3xl font-semibold tracking-tight">RaisinBot</h1>
      <p className="mt-4 text-muted-foreground">
        RaisinBot is the crawler behind Raisin, a technical SEO auditing service. It visits a
        website only when someone using Raisin starts a crawl of it.
      </p>
      <h2 className="mt-10 font-semibold">How it identifies itself</h2>
      <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">
        {DEFAULT_USER_AGENT}
      </pre>
      <p className="mt-2 text-sm text-muted-foreground">
        Requests come from Cloudflare's network and carry a{' '}
        <code className="font-mono">CF-Worker: raisin.run</code> header.
      </p>
      <h2 className="mt-10 font-semibold">How it behaves</h2>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
        <li>
          It obeys robots.txt, including <code className="font-mono">Crawl-delay</code>, using the{' '}
          <code className="font-mono">RaisinBot</code> token.
        </li>
        <li>
          Crawls of sites the requester hasn't verified are limited to 500 URLs at 2 requests per
          second.
        </li>
        <li>It backs off automatically when a server responds with 429 or 503.</li>
        <li>Requests to one host are rate-limited across every Raisin user combined.</li>
      </ul>
      <h2 className="mt-10 font-semibold">Blocking it</h2>
      <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">
        {'User-agent: RaisinBot\nDisallow: /'}
      </pre>
      <footer className="mt-16 flex flex-wrap gap-x-4 gap-y-1 border-t pt-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground hover:underline">
          About Raisin
        </Link>
        <Link to="/signup" className="hover:text-foreground hover:underline">
          Create an account
        </Link>
      </footer>
    </main>
  );
}
