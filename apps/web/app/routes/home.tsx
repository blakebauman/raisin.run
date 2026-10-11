import { Button } from '@raisin/ui/button';
import { Link, redirect } from 'react-router';
import { Logo } from '~/components/common';
import { getSession } from '~/lib/session.server';
import type { Route } from './+types/home';

export function meta(): Route.MetaDescriptors {
  return [
    { title: 'Raisin — technical SEO crawler' },
    {
      name: 'description',
      content:
        'Crawl any website and find broken links, redirects, duplicate content, indexability and hreflang problems. Runs in the cloud.',
    },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  if (await getSession(request)) throw redirect('/app');
  return null;
}

const FEATURES = [
  [
    'Every URL, every column',
    'Status codes, redirect chains, titles and descriptions in characters and pixels, headings, canonicals, directives, hreflang, structured data, word counts and response times.',
  ],
  [
    '80+ audits, prioritised',
    'Issues, warnings and opportunities with an explanation and a fix for each — broken links, redirect loops, orphan pages, missing return links, mixed content and more.',
  ],
  [
    'JavaScript rendering',
    'Render pages in headless Chrome and compare against the raw HTML: links, titles, canonicals and content that only exist after JavaScript runs.',
  ],
  [
    'Duplicate content',
    'Exact duplicates by hash, near-duplicates by simhash, and semantically similar pages by embedding similarity.',
  ],
  [
    'Link graph',
    'Inlinks, outlinks, anchor text, crawl depth and a Link Score for every page, so you can see how authority flows through the site.',
  ],
  [
    'Scheduled crawls and an API',
    'Run crawls daily, weekly or monthly, export any view to CSV, and pull results into your own tools.',
  ],
];

export default function Home() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Logo />
        <nav className="flex items-center gap-2">
          <Button asChild variant="ghost">
            <Link to="/login">Sign in</Link>
          </Button>
          <Button asChild>
            <Link to="/signup">Start crawling</Link>
          </Button>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-6">
        <section className="py-20 md:py-28">
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight md:text-6xl">
            Find what's holding your site back.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
            Raisin crawls your website the way search engines do, then shows you every broken link,
            redirect, duplicate and indexability problem — with the fix. Nothing to install.
          </p>
          <div className="mt-8 flex gap-3">
            <Button asChild size="lg">
              <Link to="/signup">Crawl 500 URLs free</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/bot">About RaisinBot</Link>
            </Button>
          </div>
        </section>
        <section className="grid gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-3">
          {FEATURES.map(([title, body]) => (
            <div key={title} className="bg-card p-6">
              <h2 className="font-semibold">{title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </section>
      </main>
      <footer className="mx-auto max-w-6xl px-6 py-12 text-sm text-muted-foreground">
        © Raisin ·{' '}
        <Link to="/bot" className="hover:underline">
          RaisinBot
        </Link>
      </footer>
    </div>
  );
}
