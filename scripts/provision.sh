#!/usr/bin/env bash
# One-time creation of the Cloudflare resources Raisin needs. Safe to re-run: anything that
# already exists is reported and skipped. D1 and KV ids are printed at the end; put them in
# apps/engine/wrangler.jsonc and apps/web/wrangler.jsonc (both Workers share the database).
set -uo pipefail
cd "$(dirname "$0")/../apps/engine"
w() { pnpm exec wrangler "$@"; }

echo "→ Queues"
for q in raisin-fetch raisin-fetch-dlq raisin-render raisin-render-dlq; do
  w queues create "$q" || echo "  (exists: $q)"
done

echo "→ R2 bucket"
w r2 bucket create raisin-data || echo "  (exists: raisin-data)"

echo "→ Vectorize index (1024 dims, cosine — matches @cf/qwen/qwen3-embedding-0.6b)"
w vectorize create raisin-pages --dimensions=1024 --metric=cosine || echo "  (exists: raisin-pages)"

echo "→ D1 database"
w d1 create raisin || echo "  (exists: raisin)"

echo "→ KV namespace for the robots.txt cache"
w kv namespace create ROBOTS_CACHE || echo "  (exists)"

echo
echo "Next:"
echo "  1. Copy the D1 database_id and KV id above into both wrangler.jsonc files."
echo "  2. pnpm --filter @raisin/web db:migrate:remote"
echo "  3. pnpm --filter @raisin/web exec wrangler secret put BETTER_AUTH_SECRET"
echo "  4. Email: pnpm exec wrangler email sending enable <your-domain>, then set EMAIL_FROM in both wrangler.jsonc files"
echo "  5. Billing (optional): set STRIPE_API_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PRO, STRIPE_PRICE_AGENCY as web secrets"
echo "  6. pnpm deploy   (engine first, then web)"
