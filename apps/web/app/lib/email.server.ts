/**
 * Outbound transactional email through the Email Service binding. In local dev the binding is
 * simulated: messages are logged and written to files, never delivered. Sending never throws —
 * a failed email must not fail the request that triggered it.
 */

import { env } from 'cloudflare:workers';
import { type EmailContent, parseSender } from '@raisin/core';

export async function sendEmail(to: string, content: EmailContent): Promise<boolean> {
  const from = parseSender(env.EMAIL_FROM ?? '');
  if (!from) return false;
  try {
    await env.EMAIL.send({
      from,
      to,
      subject: content.subject,
      html: content.html,
      text: content.text,
    });
    return true;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    console.error('email send failed', err.code ?? '', err.message ?? String(e));
    return false;
  }
}
