# CLAUDE.md

Raisin is a technical SEO crawler offered as a multi-tenant SaaS on Cloudflare. It's a pnpm + Turborepo + Biome monorepo; read README.md for the architecture.

## Commands

```bash
pnpm install
pnpm web:dev                 # web + engine together (engine is a Vite auxiliary Worker)
pnpm test                    # turbo → vitest (core in workerd, engine e2e in workerd, web in node)
pnpm lint                    # turbo → biome check
pnpm format                  # biome format --write
pnpm check-types             # turbo → tsc --noEmit (web runs react-router typegen first; while
                             # `pnpm web:dev` is running, use `pnpm --filter @raisin/web exec tsc --noEmit`
                             # instead — two typegens racing on .react-router/ crash the dev server)
pnpm --filter @raisin/engine types   # after changing apps/engine/wrangler.jsonc
pnpm --filter @raisin/web types      # after changing apps/web/wrangler.jsonc
pnpm dlx shadcn@latest add <name> --cwd packages/ui   # then fix its `cn` import to './lib/utils'
```

## Rules

- Never name the desktop SEO crawler this product resembles anywhere: code, comments, docs, commits or UI copy.
- Never use a trailing "z" in endpoint names (`/health`, not `/healthz`).
- `packages/core` has no bindings and no Cloudflare imports beyond runtime globals (HTMLRewriter, crypto). Anything that needs `env` belongs in an app.
- The per-crawl SQLite schema (`packages/core/src/schema.ts`), the audit SQL (`audits/rules.ts`) and the tab definitions (`tabs.ts`) must agree. The engine e2e test runs every rule against a real crawl and catches drift.
- Grid SQL is built only from `tabs.ts` definitions. Sort keys are checked against `SORTABLE_COLUMNS` and never interpolated from the client.
- `packages/db/src/schema.ts` must match `packages/db/migrations/*.sql` column for column. Add a new numbered migration; never edit an applied one.
- The web app talks to the engine only through `EngineRpc` (`packages/core/src/api.ts`), and never imports engine source.
- The engine trusts its caller. Authorization (org membership, plan limits, domain verification) happens in the web app before every engine call.
- Local dev state lives in `apps/web/.wrangler/state`. Every dev server started from `apps/web` shares it, and only one process can hold the SQLite files safely. Don't run `wrangler d1 migrations apply --local` while a dev server is up. If a hot restart dies with `SQLITE_BUSY`, stop and start the server again.
- Sessions are cached in a signed cookie for 5 minutes (Better Auth `cookieCache`). Never write the `session` table directly. Change session fields through Better Auth's API (for example `auth.api.setActiveOrganization`) and forward its Set-Cookie headers, or the cookie and the database drift apart.
- Email/password accounts must verify their email before signing in (`requireEmailVerification`), and invitations require a verified account. Local test users need `email_verified = 1`, or you follow the link from `apps/web/.wrangler/tmp/email/`.
- Billing derives the plan from Stripe's current subscriptions for the org's Customer (`syncCustomer`), never from an event payload. Keep it that way, so duplicate or out-of-order webhooks stay harmless.
- When adding an audit, also add a defect to `apps/fixture-site/src/site.ts` and list it in `EXPECTED`.
