import { env } from 'cloudflare:workers';
import type { EngineRpc } from '@raisin/core';
import { createDb } from '@raisin/db';

/** The engine Worker, typed by the shared RPC contract. */
export function engine(): EngineRpc & Pick<Fetcher, 'fetch'> {
  return env.ENGINE as unknown as EngineRpc & Pick<Fetcher, 'fetch'>;
}

export function db() {
  return createDb(env.DB);
}
