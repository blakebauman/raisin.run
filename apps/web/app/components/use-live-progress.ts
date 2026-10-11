import type { ProgressResult } from '@raisin/core';
import { useEffect, useRef, useState } from 'react';
import { useRevalidator } from 'react-router';

const ACTIVE = new Set(['queued', 'running', 'paused', 'stopping', 'analysing']);
const REVALIDATE_MS = 4_000;

/**
 * Live crawl progress over the crawl Durable Object's WebSocket. While the crawl is active the
 * route data (grid, issue counts) is revalidated every few seconds, and once more when the
 * status changes, so the table fills in as URLs are crawled.
 */
export function useLiveProgress(crawlId: string, initial: ProgressResult): ProgressResult {
  const [progress, setProgress] = useState(initial);
  const revalidator = useRevalidator();
  const status = useRef(initial.status);
  const active = ACTIVE.has(progress.status);

  useEffect(() => setProgress(initial), [initial]);

  useEffect(() => {
    if (!ACTIVE.has(initial.status)) return;
    let socket: WebSocket | null = null;
    let retry = 0;
    let closed = false;
    let ping: ReturnType<typeof setInterval> | undefined;
    const connect = () => {
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${scheme}://${location.host}/app/crawls/${crawlId}/live`);
      socket.onopen = () => {
        retry = 0;
        ping = setInterval(
          () => socket?.readyState === WebSocket.OPEN && socket.send('ping'),
          20_000,
        );
      };
      socket.onmessage = (event) => {
        const msg = JSON.parse(String(event.data)) as { type: string; data: ProgressResult };
        if (msg.type !== 'progress') return;
        setProgress(msg.data);
        if (msg.data.status !== status.current) {
          status.current = msg.data.status;
          revalidator.revalidate();
        }
      };
      socket.onclose = () => {
        clearInterval(ping);
        if (!closed) setTimeout(connect, Math.min(30_000, 1_000 * 2 ** retry++));
      };
    };
    connect();
    return () => {
      closed = true;
      clearInterval(ping);
      socket?.close();
    };
  }, [crawlId, initial.status]);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (revalidator.state === 'idle' && document.visibilityState === 'visible')
        revalidator.revalidate();
    }, REVALIDATE_MS);
    return () => clearInterval(timer);
  }, [active, revalidator]);

  return progress;
}
