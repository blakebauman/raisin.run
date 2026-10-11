import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { handle } from '@raisin/fixture-site';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('../../packages/db/migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        // AI, Vectorize and Browser Run stay unused in tests; never reach for remote resources.
        remoteBindings: false,
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, HOST_MIN_INTERVAL_MS: '0' },
          // Every outbound fetch — robots.txt, sitemaps, pages — is answered by the fixture site.
          outboundService: (request: Request) => handle(request),
        },
      }),
    ],
    test: {
      include: ['tests/**/*.test.ts'],
      setupFiles: ['./tests/setup.ts'],
      testTimeout: 60_000,
    },
  };
});
