# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: SEO agencies and independent consultants.** They audit many client sites, not just one. Each client gets a project. They run scheduled crawls, work through the issues in the URL grid, and send findings back to clients and their developers as CSV exports or through the API. A typical session covers several sites in a row: check what changed since the last crawl, triage the new issues, and pull out what the client needs to see.

In-house technical SEOs and developers checking their own sites also use the product. They are secondary audiences and should not drive product decisions.

## Product Purpose

Raisin is a technical SEO crawler offered as a multi-tenant SaaS. It crawls a site and records every URL's status, redirects, titles and descriptions (in characters and pixels), headings, canonicals, directives, hreflang, structured data, links and images. It then runs 80+ audits on the results. It can render pages in headless Chrome to compare them against the raw HTML, and it finds exact, near and semantic duplicates.

Success means an agency can run a full audit of a client site and explain what to fix without installing anything or being limited by their own machine.

## Positioning

**Raisin runs in the cloud.** There is nothing to install and no laptop memory limit. Crawls keep running after the user closes the lid, and results are shared with the whole team instead of sitting on one person's machine. The product is a familiar desktop-style spider moved to the cloud, so the work it supports should feel familiar to people who already use one.

Never name the desktop crawler Raisin resembles, in any copy, code or documentation.

## Operating Context

- **Workflow.** Org → projects (one per client site) → crawls → a URL grid with tabs (titles, directives, hreflang and so on) and issue filters → details for each URL → CSV export or REST API (`/api/v1`).
- **Live progress.** While a crawl runs, progress and issue counts update over a WebSocket.
- **Scheduled crawls.** Crawls can run daily, weekly or monthly, so users compare one crawl against the previous one.
- **Teams.** Users belong to organizations, can be invited to them, and can switch between them.
- **Verification.** Users prove they own a site with a DNS TXT record, a meta tag or a file. Crawls of unverified sites are limited to 500 URLs at 2 URLs/s and always obey robots.txt.

## Capabilities and Constraints

- Unverified sites are crawled at the limits above. The crawler refuses IP literals, internal hostnames and non-web ports. It paces requests to each host across all tenants combined, and backs off on 429/503 responses.
- JavaScript rendering, AI duplicate similarity, scheduled crawls and API access exist, but each is limited to certain plans.
- **Undecided:** pricing and plan limits. The Free/Pro/Agency tiers in the README are placeholders, not public prices. Never present them as final.
- **Undecided:** whether the name and logo mark are final. "Raisin" and "RaisinBot" are the working names.

## Brand Commitments

- **RaisinBot transparency is part of the brand.** The crawler is polite and identifies itself. The `/bot` page explains how it identifies itself (user agent, `CF-Worker: raisin.run` header), that it obeys robots.txt and backs off when servers push back, and that it only visits a site when a Raisin user starts a crawl. Future work should treat good crawler citizenship as something Raisin is proud of, not as fine print.
- **Copy voice so far:** plain, specific and technical, describing what the product actually does ("titles and descriptions in characters and pixels"). It has no hype.

## Evidence on Hand

- **None yet.** There are no customers, testimonials, case studies, benchmarks, press or partner logos. Future pages must not invent any of these.
- The real material available is the product itself: the audit catalogue (`packages/core/src/audits/rules.ts`), the tab and column definitions (`packages/core/src/tabs.ts`), and real crawl output (the defect-filled fixture site in `apps/fixture-site` produces honest demo data).

## Product Principles

1. **Built for people who audit many sites.** Projects, schedules, exports and the API are core features, not extras. Moving between client sites should be fast.
2. **Cloud is the advantage, so show it.** Live progress, crawls that survive closed laptops, and results the team can share are the reasons to choose Raisin. Treat them as features.
3. **Every issue comes with an explanation and a fix.** Each audit says why the issue matters and what to do about it, so agencies can pass it on to clients unchanged.
4. **Be a good crawler.** Pace requests politely, require verification before large crawls, and be open about how RaisinBot behaves. Raisin should earn trust from the sites it crawls as well as from its users.
5. **Honesty over polish.** Show only real data and real proof. Don't invent claims, customers or prices.
