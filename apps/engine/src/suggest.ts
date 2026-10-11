/**
 * On-demand AI suggestions from the URL detail pane: alt text for an image, or a title and meta
 * description for a page. Uses a multimodal Workers AI model, through AI Gateway when one is set.
 * The web app meters each call against the org's plan before calling this.
 */

import { checkTarget, type SuggestionKind } from '@raisin/core';
import type { CrawlDO } from './crawl-do';

export const SUGGESTION_MODEL = '@cf/google/gemma-4-26b-a4b-it';
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

type Message = {
  role: 'system' | 'user';
  content:
    | string
    | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];
};

export async function suggest(
  env: Env,
  crawl: DurableObjectStub<CrawlDO>,
  urlId: number,
  kind: SuggestionKind,
  imageUrl?: string,
): Promise<{ text: string; model: string }> {
  const page = await crawl.pageForSuggestion(urlId);
  if (!page) throw new Error('URL not found in this crawl');

  let messages: Message[];
  if (kind === 'alt') {
    if (!imageUrl) throw new Error('imageUrl is required for alt text');
    // Only images the crawl actually found on this page, held to the crawler's target rules.
    // Otherwise this endpoint is a free, unmetered fetch-anything proxy.
    if (!(await crawl.pageHasImage(urlId, imageUrl)) || !checkTarget(imageUrl).ok) {
      throw new Error('That image is not on this page');
    }
    let res: Response;
    try {
      res = await fetch(imageUrl, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new Error('Could not load the image');
    }
    // Generic messages: upstream status codes and network errors are not echoed back.
    if (!res.ok) throw new Error('Could not load the image');
    const type = res.headers.get('content-type') ?? 'image/jpeg';
    if (!type.startsWith('image/')) throw new Error('Not an image');
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('Image is larger than 4 MB');
    messages = [
      {
        role: 'system',
        content:
          'You write alt text for web images. Reply with the alt text only: one plain sentence under 125 characters, no quotes, no "image of".',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `The image appears on a page titled "${page.title ?? page.url}". Describe it for a screen-reader user.`,
          },
          { type: 'image_url', image_url: { url: `data:${type};base64,${base64(bytes)}` } },
        ],
      },
    ];
  } else {
    messages = [
      {
        role: 'system',
        content:
          'You are an SEO copywriter. Reply with exactly two lines: "Title: <under 60 characters>" and "Description: <120 to 155 characters>". Match the page language. No marketing clichés.',
      },
      {
        role: 'user',
        content: `URL: ${page.url}\nCurrent title: ${page.title ?? '(none)'}\nCurrent H1: ${page.h1 ?? '(none)'}\nCurrent description: ${page.metaDesc ?? '(none)'}\n\nPage text:\n${(page.text ?? '').slice(0, 3000)}`,
      },
    ];
  }

  const gateway = env.AI_GATEWAY_ID ? { gateway: { id: env.AI_GATEWAY_ID } } : undefined;
  const out = (await env.AI.run(
    SUGGESTION_MODEL as keyof AiModels,
    { messages, max_tokens: 200 } as never,
    gateway,
  )) as {
    response?: string;
    choices?: { message?: { content?: string } }[];
  };
  const text = (out.response ?? out.choices?.[0]?.message?.content ?? '').trim();
  return { text, model: SUGGESTION_MODEL };
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
