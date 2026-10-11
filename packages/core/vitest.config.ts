import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Core runs in workerd, not Node: the extractor depends on HTMLRewriter.
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: { compatibilityDate: '2026-10-01', compatibilityFlags: ['nodejs_compat'] },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
