# Raisin

A technical SEO crawler, offered as a multi-tenant SaaS and built entirely on Cloudflare. Raisin crawls a site and records every URL's status, redirects, titles and descriptions (in characters and pixels), headings, canonicals, directives, hreflang, structured data, links and images. It then runs 80+ audits. It can also render pages in headless Chrome to compare against the raw HTML, and find exact, near and semantic duplicates.

## How it works

```
browser ──► apps/web (React Router on Workers) ──RPC──► apps/engine
              │ D1: users, orgs, projects,               ├─ Crawl DO (one per crawl): frontier + results in SQLite
              │     crawls, schedules, keys, usage       ├─ HostLimiter DO (one per target host)
              │ Better Auth + organizations              ├─ Queues: raisin-fetch, raisin-render (+ DLQs)
              │ /api/v1 REST, cron for schedules         ├─ Browser Run: JS rendering, shared sessions
              └─ live progress: WebSocket ──────────────►├─ CrawlLifecycle Workflow: sitemaps → crawl → analysis → export
                                                         └─ R2 (HTML, screenshots, CSV), KV (robots.txt), Workers AI + Vectorize
```

- **Crawl Durable Object.** It holds the frontier (deduplicated, breadth-first, leased so lost messages retry) and every result table: pages, links, images, hreflang, issues and duplicates. An alarm dispatches URLs at the configured rate. The dashboard queries this DO directly, so sorting and filtering run against the crawl's own SQLite database.
- **Queue consumers.** They fetch with manual redirects, so every hop is recorded. They check robots.txt from a KV cache, pace each host through `HostLimiter`, and extract everything in one streaming HTMLRewriter pass (`packages/core/src/extract.ts`). Pages that need JavaScript go to the render queue, which loads them in Browser Run and runs the same extractor on the rendered DOM.
- **CrawlLifecycle Workflow.** It discovers sitemaps, starts the crawl, waits for the DO's `drained` event, then runs the analysis as durable steps:
  - link counts
  - redirect loops
  - simhash near-duplicates
  - Link Score (PageRank)
  - audit rules
  - optional embedding similarity
  - CSV export
  - D1 summary
- **Audits** are declarative SQL in `packages/core/src/audits/rules.ts`. Page-level rules run as each batch is ingested, so issue counts update live. Rules that need the whole crawl run during analysis.

## Repository

| Path | Role |
|---|---|
| `apps/web` (`@raisin/web`) | Dashboard, auth, REST API, schedule cron — React Router on Workers |
| `apps/engine` (`@raisin/engine`) | Crawl engine Worker: DOs, queue consumers, Workflow, `EngineApi` RPC |
| `apps/fixture-site` (`@raisin/fixture-site`) | A small site full of deliberate SEO defects; drives the engine's e2e test |
| `packages/core` (`@raisin/core`) | Crawler logic with no bindings: URLs, robots.txt, sitemaps, extractor, SERP widths, simhash, schema, audits, tabs, RPC contract |
| `packages/db` (`@raisin/db`) | D1 schema (Drizzle) and migrations |
| `packages/ui` (`@raisin/ui`) | shadcn/ui primitives, consumed as raw `.tsx` |
| `packages/typescript-config` | Shared tsconfig bases |

## Develop

```bash
pnpm install
cp apps/web/.dev.vars.example apps/web/.dev.vars   # set BETTER_AUTH_SECRET, APP_URL
pnpm db:migrate:local
pnpm web:dev            # web + engine in one Vite session (engine runs as an auxiliary Worker)
pnpm test               # core unit tests, engine e2e crawl, web unit tests
pnpm lint && pnpm check-types
```

In local dev, JavaScript rendering runs against a local Chrome that Wrangler downloads into `~/Library/Caches/.wrangler/chrome` the first time it's needed. If the first render hangs on "Downloading browser…", the extraction stalled: unzip the cached zip into its `mac_arm-<version>` folder and restart the dev server. Workers AI reaches your Cloudflare account, and Vectorize doesn't run locally, so AI similarity needs a deployed engine. Everything else works offline. Local crawls go to real websites, and private or loopback targets are refused, so to crawl the fixture site you have to deploy it.

## Deploy

```bash
pnpm exec wrangler login
./scripts/provision.sh          # queues, R2, Vectorize, D1, KV
# put the printed D1/KV ids into apps/engine/wrangler.jsonc and apps/web/wrangler.jsonc
pnpm --filter @raisin/web db:migrate:remote
pnpm --filter @raisin/web exec wrangler secret put BETTER_AUTH_SECRET
pnpm deploy                     # engine first (web binds to it), then web
```

### Billing (Stripe)

Create one Product per paid plan (Pro, Agency), each with a monthly Price. Then on the web Worker:

```bash
wrangler secret put STRIPE_API_KEY          # a restricted key (rk_…): Customers, Checkout Sessions,
                                            # Customer Portal and Subscriptions write; Prices read
wrangler secret put STRIPE_WEBHOOK_SECRET   # from a webhook endpoint at https://raisin.run/api/stripe/webhook
wrangler secret put STRIPE_PRICE_PRO        # price_…
wrangler secret put STRIPE_PRICE_AGENCY     # price_…
```

Subscribe the endpoint to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.*` and `invoice.paid` / `invoice.payment_failed`. Each event re-reads the customer's subscriptions from Stripe and sets the org's plan from them, so it doesn't matter if events arrive twice or out of order. A subscription that is `past_due` keeps its plan while Stripe retries the payment. Upgrades go through Checkout, and plan changes, cancellation, payment methods and invoices through the Customer Portal. Configure the Portal in the Stripe Dashboard. If you charge US or EU customers, enable Stripe Tax: `automatic_tax` collects nothing until you have an active tax registration.

### Email

Both Workers send through the Email Service `send_email` binding: invitations from the web Worker, crawl-finished summaries from the engine. Onboard the sender domain (`wrangler email sending enable raisin.run`) and set `EMAIL_FROM` in both `wrangler.jsonc` files. An empty `EMAIL_FROM` turns email off. In local dev the binding is simulated, and messages are written to `apps/web/.wrangler/tmp/email/`. Each user can turn crawl-finished emails off under **Settings → Email notifications**.

Optional secrets on the web Worker: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (Google sign-in), and `TURNSTILE_SECRET_KEY` with the `TURNSTILE_SITE_KEY` var (signup challenge). Setting `AI_GATEWAY_ID` on the engine routes AI calls through AI Gateway.

## Plans and safety

Plans live in the `plans` table:
- **Free:** 500 URLs, 1 project.
- **Pro:** 100k URLs, rendering, AI, schedules.
- **Agency:** 400k URLs and the API.

Crawls of sites the user hasn't verified are capped at 500 URLs and 2 URLs/s, and always obey robots.txt. A site is verified by a DNS TXT record, a meta tag or a file. The crawler refuses IP literals, internal hostnames and non-web ports. It paces each host across all tenants, and backs off on 429/503.

## Accounts

Better Auth runs on D1. New email/password accounts get a confirmation link and can't sign in until they follow it. Google sign-ins arrive verified. Sessions last 30 days and are cached in a signed cookie for 5 minutes, so most requests don't read D1; the trade-off is that a session revoked elsewhere stays usable on that device for up to 5 minutes.

## Teams

Every user gets a personal organization. Owners and admins invite people from **Settings**: Raisin creates a Better Auth invitation, emails it, and also shows a link to copy. The invitee signs in or signs up with the invited address and accepts at `/invite/:id`. A user in several organizations switches between them from the sidebar.

## Maintenance

The web Worker's cron (every 15 minutes) starts due scheduled crawls, marks crawls failed when their Workflow has errored or never started, and deletes crawls, with their R2 objects and Durable Object storage, once they're older than the plan's retention period.

## REST API

These routes are available on plans with API access. Authenticate with `Authorization: Bearer rsn_…` (create a key in Settings).

```
GET  /api/v1/projects
GET  /api/v1/projects/:id/crawls
POST /api/v1/projects/:id/crawls        { "config": { "maxUrls": 1000, ... } }
GET  /api/v1/crawls/:id                 status + live progress
GET  /api/v1/crawls/:id/issues
GET  /api/v1/crawls/:id/urls?tab=titles&filter=title.duplicate&q=&sort=&dir=&offset=&limit=
GET  /api/v1/crawls/:id/urls/:urlId
POST /api/v1/crawls/:id/pause | resume | stop
```
