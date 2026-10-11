/**
 * Queue consumers for `raisin-fetch` and `raisin-render`. A batch is processed concurrently,
 * results are grouped by crawl, and each crawl's Durable Object receives one ingest call per
 * batch. Messages are acked only after their result is stored; a failed ingest retries the
 * whole group, which is safe because ingest ignores URLs already marked done.
 */

import type { FetchResult, FetchTask } from '@raisin/core';
import { fetchTask, RetryLater } from './fetcher';
import { renderTask } from './renderer';

export async function consume(batch: MessageBatch<FetchTask>, env: Env): Promise<void> {
  const render = batch.queue.startsWith('raisin-render');
  const byCrawl = new Map<string, { messages: Message<FetchTask>[]; results: FetchResult[] }>();

  await Promise.all(
    batch.messages.map(async (message) => {
      const task = message.body;
      try {
        const result = render ? await renderTask(task, env) : await fetchTask(task, env);
        let group = byCrawl.get(task.doName);
        if (!group) {
          group = { messages: [], results: [] };
          byCrawl.set(task.doName, group);
        }
        group.messages.push(message);
        group.results.push(result);
      } catch (e) {
        if (e instanceof RetryLater) {
          message.retry({ delaySeconds: Math.min(e.delaySeconds, 600) });
        } else {
          console.error('fetch task failed', task.url, e);
          message.retry({ delaySeconds: 30 });
        }
      }
    }),
  );

  await Promise.all(
    [...byCrawl].map(async ([doName, group]) => {
      try {
        await env.CRAWL.getByName(doName).ingest(group.results);
        for (const m of group.messages) m.ack();
      } catch (e) {
        console.error('ingest failed', doName, e);
        for (const m of group.messages) m.retry({ delaySeconds: 10 });
      }
    }),
  );
}
