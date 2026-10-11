/**
 * A deliberately broken little website. Every page exists to trigger specific audits, and
 * `EXPECTED` lists them, so the end-to-end test can assert exact results. The host doesn't
 * matter: links are relative, and the test points the crawler at FIXTURE_ORIGIN.
 */

export const FIXTURE_ORIGIN = 'https://fixture.raisin.test';

const LOREM_FREE_WORDS =
  'Our widgets are machined from recycled aluminium in a small workshop and finished by hand. Each one ships with a lifetime warranty, a printed manual and spare fittings. Customers use them in kitchens, garages and studios, and many tell us they have outlasted every other tool they own. We test every batch for tolerance and finish before it leaves the bench, and we publish the results. If something goes wrong we repair it for free, and if we cannot repair it we replace it. Shipping is carbon neutral and packaging is plastic free. The widget weighs four hundred grams, measures twelve centimetres and comes in three colours: graphite, sand and moss. Mounting brackets are sold separately, along with a carry case made from waxed canvas.';

const widgetText = (variant: string) =>
  `${LOREM_FREE_WORDS} This model is the ${variant} edition. ${LOREM_FREE_WORDS}`;

type Page = {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
};

const html = (opts: {
  title?: string | null;
  description?: string | null;
  h1?: string | null;
  head?: string;
  body: string;
  lang?: string;
}) => `<!doctype html>
<html lang="${opts.lang ?? 'en'}">
<head>
<meta charset="utf-8">
${opts.title === null ? '' : `<title>${opts.title ?? 'Fixture page'}</title>`}
${opts.description ? `<meta name="description" content="${opts.description}">` : ''}
${opts.head ?? ''}
</head>
<body>
<nav><a href="/">Home</a> <a href="/about">About</a> <a href="/products/">Products</a> <a href="/blog/">Blog</a></nav>
${opts.h1 === null ? '' : `<h1>${opts.h1 ?? opts.title ?? 'Fixture'}</h1>`}
${opts.body}
</body>
</html>`;

// Two richer templates, so the crawl has page types to find: a product page (served under two
// URL prefixes, so the types step has to merge patterns) and a journal article.
const productPage = (name: string, price: string, blurb: string) =>
  html({
    title: `${name} — Fixture Workshop shop`,
    description: `${name}, made by hand in the Fixture workshop. ${price}.`,
    h1: null,
    body: `
<main class="product layout">
  <div class="product-gallery"><img src="/img/logo.png" alt="${name}" width="100" height="40"></div>
  <section class="product-info">
    <h1 class="product-title">${name}</h1>
    <p class="price"><span class="amount">${price}</span></p>
    <div class="product-description"><p>${blurb}</p><p>${LOREM_FREE_WORDS}</p></div>
    <form class="add-to-basket" action="/basket" method="post">
      <select name="qty"><option>1</option><option>2</option></select>
      <button class="btn btn-primary" type="submit">Add to basket</button>
    </form>
  </section>
  <aside class="related"><h2>You may also like</h2>
    <ul class="cards"><li class="card"><a href="/shop/linen-apron">Linen apron</a></li></ul>
  </aside>
</main>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"${name}"}</script>`,
  });

const journalPage = (title: string, date: string, paragraphs: string[]) =>
  html({
    title: `${title} — Fixture Journal`,
    description: `${title}: notes from the Fixture workshop journal.`,
    h1: null,
    body: `
<div class="wrapper">
  <article class="post">
    <header class="post-header"><h1 class="post-title">${title}</h1><time datetime="${date}">${date}</time></header>
    <div class="post-body">${paragraphs.map((p) => `<p>${p}</p>`).join('')}
      <blockquote class="pull-quote"><p>Measure twice, cut once.</p></blockquote>
      <figure><img src="/img/logo.png" alt="The bench" width="100" height="40"><figcaption>The bench.</figcaption></figure>
    </div>
    <footer class="post-footer"><a class="author" href="/about">The workshop</a></footer>
  </article>
</div>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"${title}"}</script>`,
  });

const SECURITY_HEADERS = {
  'strict-transport-security': 'max-age=31536000',
  'content-security-policy': "default-src 'self'; frame-ancestors 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

const PAGES: Record<string, Page> = {
  '/robots.txt': {
    headers: { 'content-type': 'text/plain' },
    body: `User-agent: *\nDisallow: /private/\n\nSitemap: ${FIXTURE_ORIGIN}/sitemap.xml\n`,
  },
  '/sitemap.xml': {
    headers: { 'content-type': 'application/xml' },
    body: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${FIXTURE_ORIGIN}/</loc></url>
  <url><loc>${FIXTURE_ORIGIN}/about</loc></url>
  <url><loc>${FIXTURE_ORIGIN}/orphan</loc></url>
  <url><loc>${FIXTURE_ORIGIN}/broken</loc></url>
</urlset>`,
  },
  '/': {
    headers: SECURITY_HEADERS,
    body: html({
      title: 'Fixture Home',
      description:
        'The fixture site home page, full of deliberate mistakes for the crawler to find.',
      head: '<link rel="canonical" href="/">',
      body: `
<p>${LOREM_FREE_WORDS}</p>
<p><a href="/redirect-1">Old offers</a> <a href="/broken">Broken link</a> <a href="/noindex">Hidden page</a>
<a href="/en/">English</a> <a href="/private/page">Members</a> <a href="/secret" rel="nofollow">Secret</a>
<a href="/mixed">Mixed</a> <a href="/shop/oak-chopping-board">Chopping board</a> <a href="/gifts/brass-bottle-opener">Gifts</a>
<a href="/journal/how-we-oil-oak">Journal</a> <a href="https://external.example/">Partner site</a> <a href="https://external.example/gone">Dead partner</a></p>
<img src="/img/logo.png" alt="Fixture logo" width="100" height="40">
<img src="/img/big.jpg">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Fixture"}</script>`,
    }),
  },
  '/about': {
    body: html({
      // Same title as the home page; no H1.
      title: 'Fixture Home',
      h1: null,
      body: `<p>About us. ${LOREM_FREE_WORDS}</p><p><a href="/loop-a">Loop</a> <a href="/products/">click here</a></p>`,
    }),
  },
  '/products/': {
    body: html({
      title: 'Products — the full range of fixture widgets',
      description: 'Every widget we make, from the classic to the deluxe edition.',
      body: `<p>${LOREM_FREE_WORDS}</p>
<ul><li><a href="/products/widget-a">Widget A</a></li><li><a href="/products/widget-b">Widget B</a></li>
<li><a href="/products/widget-a-copy">Widget A (copy)</a></li></ul>`,
    }),
  },
  '/products/widget-a': {
    body: html({
      title: 'Widget A — classic aluminium widget',
      description: 'Widget A, the classic edition, machined from recycled aluminium.',
      body: `<p>${widgetText('classic')}</p>`,
    }),
  },
  // Identical visible text to widget-a: an exact duplicate.
  '/products/widget-a-copy': {
    body: html({
      title: 'Widget A — classic aluminium widget',
      description: 'Widget A, the classic edition, machined from recycled aluminium.',
      body: `<p>${widgetText('classic')}</p>`,
    }),
  },
  // One word different from widget-a: a near duplicate.
  '/products/widget-b': {
    body: html({
      title: 'Widget B — deluxe aluminium widget',
      description: 'Widget B, the deluxe edition, machined from recycled aluminium.',
      body: `<p>${widgetText('deluxe')}</p>`,
    }),
  },
  '/blog/': {
    body: html({
      title: 'Blog',
      description: 'Notes from the workshop.',
      body: `<p>Notes.</p><a href="/blog/post-1">Read the first post</a> <a href="/blog/page/2">Older</a>`,
    }),
  },
  '/blog/post-1': {
    body: html({
      // Over 60 characters; no meta description.
      title: 'How we machine a widget from a single block of recycled aluminium, step by step',
      body: `<p>${LOREM_FREE_WORDS}</p>`,
    }),
  },
  '/blog/page/2': {
    body: html({
      title: 'Blog — page 2',
      head: '<link rel="prev" href="/blog/"><meta name="robots" content="noindex">',
      body: '<p>Older notes.</p>',
    }),
  },
  '/redirect-1': { status: 301, headers: { location: '/redirect-2' } },
  '/redirect-2': { status: 301, headers: { location: '/final' } },
  '/final': { body: html({ title: 'Final destination', body: `<p>${LOREM_FREE_WORDS}</p>` }) },
  '/loop-a': { status: 302, headers: { location: '/loop-b' } },
  '/loop-b': { status: 302, headers: { location: '/loop-a' } },
  '/noindex': {
    body: html({
      title: 'Hidden page',
      head: '<meta name="robots" content="noindex, follow">',
      body: '<p>Not for search engines.</p>',
    }),
  },
  '/en/': {
    body: html({
      title: 'English edition',
      lang: 'en',
      head: `<link rel="alternate" hreflang="en" href="${FIXTURE_ORIGIN}/en/"><link rel="alternate" hreflang="fr" href="${FIXTURE_ORIGIN}/fr/">`,
      body: `<p>${LOREM_FREE_WORDS}</p>`,
    }),
  },
  // Does not link back to /en/: a missing return link.
  '/fr/': {
    body: html({
      title: 'Édition française',
      lang: 'fr',
      head: `<link rel="alternate" hreflang="fr" href="${FIXTURE_ORIGIN}/fr/">`,
      body: '<p>Bonjour.</p>',
    }),
  },
  '/mixed': {
    body: html({
      title: 'Mixed content page',
      body: '<img src="http://fixture.raisin.test/img/logo.png" alt="Logo">',
    }),
  },
  '/shop/oak-chopping-board': {
    body: productPage('Oak chopping board', '£45', 'Cut from a single plank of English oak.'),
  },
  '/shop/linen-apron': {
    body: productPage('Linen apron', '£30', 'Heavy linen with brass rivets and deep pockets.'),
  },
  '/gifts/brass-bottle-opener': {
    body: productPage('Brass bottle opener', '£18', 'Solid brass, engraved by hand.'),
  },
  '/journal/how-we-oil-oak': {
    body: journalPage('How we oil oak', '2026-09-01', [
      LOREM_FREE_WORDS,
      'Three coats, a day apart. <a href="/journal/a-week-at-the-bench">A week at the bench</a>.',
    ]),
  },
  '/journal/a-week-at-the-bench': {
    body: journalPage('A week at the bench', '2026-09-15', [
      'Monday is for sharpening. The rest of the week is for making.',
      LOREM_FREE_WORDS,
    ]),
  },
  '/orphan': { body: html({ title: 'Orphan page', body: '<p>Nobody links here.</p>' }) },
  '/private/page': { body: html({ title: 'Private', body: '<p>Members only.</p>' }) },
  '/secret': { body: html({ title: 'Secret', body: '<p>Only linked with nofollow.</p>' }) },
};

const EXTERNAL: Record<string, Page> = {
  'https://external.example/': { body: html({ title: 'Partner', body: '<p>Partner.</p>' }) },
};

/** Audit rules each fixture URL must trigger, by path. Asserted by the engine's e2e test. */
export const EXPECTED: Record<string, string[]> = {
  '/broken': ['response.internal_4xx'],
  '/redirect-1': ['response.redirect_chain', 'response.internal_3xx'],
  '/loop-a': ['response.redirect_loop'],
  '/loop-b': ['response.redirect_loop'],
  '/': [
    'title.duplicate',
    'links.internal_to_broken',
    'links.internal_to_redirect',
    'title.below_chars',
  ],
  '/about': ['title.duplicate', 'h1.missing', 'links.non_descriptive_anchor'],
  '/img/big.jpg': [
    'images.missing_alt_attribute',
    'images.over_100kb',
    'images.missing_dimensions',
  ],
  '/en/': ['hreflang.missing_return', 'hreflang.missing_x_default'],
  '/orphan': ['sitemaps.orphan'],
  '/private/page': ['response.blocked_robots'],
  '/products/widget-a': ['content.exact_duplicate', 'title.duplicate', 'meta_desc.duplicate'],
  '/products/widget-a-copy': ['content.exact_duplicate'],
  '/products/widget-b': ['content.near_duplicate'],
  '/blog/post-1': ['title.over_chars', 'meta_desc.missing'],
  '/blog/page/2': ['directives.noindex', 'pagination.non_indexable'],
  '/noindex': ['directives.noindex'],
  '/mixed': ['security.mixed_content', 'security.missing_hsts'],
};

/** Page types the crawl must find: URL patterns that share one type, and its structured data type. */
export const EXPECTED_PAGE_TYPES: { patterns: string[]; sdType: string; pages: number }[] = [
  { patterns: ['/shop/{slug}', '/gifts/{slug}'], sdType: 'Product', pages: 3 },
  { patterns: ['/journal/{slug}'], sdType: 'Article', pages: 2 },
];

/** URLs that must never be fetched. */
export const NOT_CRAWLED = ['/secret'];

export function handle(request: Request): Response {
  const url = new URL(request.url);
  const external = EXTERNAL[url.origin + url.pathname];
  if (url.origin !== FIXTURE_ORIGIN && url.origin !== FIXTURE_ORIGIN.replace('https:', 'http:')) {
    return external ? respond(external) : new Response('Not found', { status: 404 });
  }
  if (url.pathname === '/img/logo.png') {
    return new Response(new Uint8Array(2_000), {
      headers: { 'content-type': 'image/png', 'content-length': '2000' },
    });
  }
  if (url.pathname === '/img/big.jpg') {
    return new Response(new Uint8Array(200_000), {
      headers: { 'content-type': 'image/jpeg', 'content-length': '200000' },
    });
  }
  const page = PAGES[url.pathname];
  if (!page)
    return new Response(html({ title: 'Not found', body: '<p>Missing.</p>' }), {
      status: 404,
      headers: { 'content-type': 'text/html' },
    });
  return respond(page);
}

function respond(page: Page): Response {
  const headers = new Headers({ 'content-type': 'text/html; charset=utf-8', ...page.headers });
  return new Response(page.body ?? null, { status: page.status ?? 200, headers });
}
