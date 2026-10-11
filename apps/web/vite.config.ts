import { cloudflare } from '@cloudflare/vite-plugin';
import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

/** Where this dev server is reachable; links in the engine's emails point here. */
const DEV_APP_URL = process.env.RAISIN_DEV_URL ?? 'http://localhost:5180';

export default defineConfig({
  plugins: [
    cloudflare({
      viteEnvironment: { name: 'ssr' },
      // In dev, run the engine Worker in the same session so the ENGINE service binding,
      // its Durable Objects, queues and Workflow all work locally. It deploys on its own.
      auxiliaryWorkers: [
        {
          configPath: '../engine/wrangler.jsonc',
          devOnly: true,
          config: (config) => ({ vars: { ...config.vars, APP_URL: DEV_APP_URL } }),
        },
      ],
    }),
    tailwindcss(),
    reactRouter(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
});
