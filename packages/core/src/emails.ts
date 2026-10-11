/**
 * Transactional email templates, shared by the web Worker (invitations) and the engine
 * (crawl-finished notices). Every template returns both HTML and plain text.
 */

export type EmailContent = { subject: string; html: string; text: string };

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function layout(title: string, body: string, action: { label: string; href: string }): string {
  return `<!doctype html>
<html><body style="margin:0;background:#f7f7f8;font-family:-apple-system,'Segoe UI',Inter,Arial,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border:1px solid #e4e4e7;border-radius:12px">
<tr><td style="padding:28px 28px 8px;font-weight:600;font-size:15px;color:#5b2a5e">raisin</td></tr>
<tr><td style="padding:8px 28px 0"><h1 style="margin:0;font-size:20px;line-height:1.3">${esc(title)}</h1></td></tr>
<tr><td style="padding:12px 28px 0;font-size:14px;line-height:1.6;color:#3f3f46">${body}</td></tr>
<tr><td style="padding:20px 28px 28px"><a href="${esc(action.href)}" style="display:inline-block;background:#6b2f6e;color:#fff;text-decoration:none;font-size:14px;font-weight:500;padding:10px 16px;border-radius:8px">${esc(action.label)}</a></td></tr>
</table>
<p style="font-size:12px;color:#71717a;margin:16px 0 0">Raisin · technical SEO crawler</p>
</td></tr></table></body></html>`;
}

export function invitationEmail(input: {
  orgName: string;
  inviterName: string;
  role: string;
  link: string;
}): EmailContent {
  const role = input.role === 'admin' ? 'an admin' : `a ${input.role}`;
  const subject = `${input.inviterName} invited you to ${input.orgName} on Raisin`;
  const line = `${input.inviterName} invited you to join ${input.orgName} on Raisin as ${role}.`;
  return {
    subject,
    html: layout(
      `Join ${input.orgName}`,
      `<p style="margin:0">${esc(line)}</p><p style="margin:12px 0 0">Sign in or create an account with this email address to accept. The invitation expires in 48 hours.</p>`,
      { label: 'Accept invitation', href: input.link },
    ),
    text: `${line}\n\nAccept the invitation (sign in or create an account with this email address):\n${input.link}\n\nThe invitation expires in 48 hours.`,
  };
}

export function verificationEmail(input: { name: string; link: string }): EmailContent {
  const hello = input.name ? `Hi ${input.name},` : 'Hi,';
  const line = 'Confirm your email address to finish setting up your Raisin account.';
  return {
    subject: 'Confirm your email for Raisin',
    html: layout(
      'Confirm your email',
      `<p style="margin:0">${esc(hello)}</p><p style="margin:12px 0 0">${esc(line)} The link expires in an hour. If you didn't sign up, ignore this email.</p>`,
      { label: 'Confirm email', href: input.link },
    ),
    text: `${hello}\n\n${line}\n\n${input.link}\n\nThe link expires in an hour. If you didn't sign up, ignore this email.`,
  };
}

export function crawlFinishedEmail(input: {
  projectName: string;
  startUrl: string;
  crawled: number;
  totals: { issue: number; warning: number; opportunity: number };
  /** Totals of new and fixed issues against the previous crawl, when there is one. */
  change: { new: number; fixed: number } | null;
  link: string;
}): EmailContent {
  const { issue, warning, opportunity } = input.totals;
  const counts = `${plural(issue, 'issue')}, ${plural(warning, 'warning')} and ${plural(opportunity, 'opportunity', 'opportunities')}`;
  const changeLine = input.change
    ? `Since the last crawl: ${input.change.new.toLocaleString()} new, ${input.change.fixed.toLocaleString()} fixed.`
    : null;
  const subject = `Crawl finished: ${input.projectName} — ${plural(issue, 'issue')}`;
  const crawledLine = `Raisin crawled ${plural(input.crawled, 'URL')} on ${input.startUrl} and found ${counts}.`;
  return {
    subject,
    html: layout(
      `${input.projectName} crawl finished`,
      `<p style="margin:0">${esc(crawledLine)}</p>${changeLine ? `<p style="margin:12px 0 0">${esc(changeLine)}</p>` : ''}`,
      { label: 'View results', href: input.link },
    ),
    text: `${crawledLine}${changeLine ? `\n${changeLine}` : ''}\n\nView results: ${input.link}`,
  };
}

/** `Raisin <notifications@raisin.run>` → `{ name, email }`; a bare address stays a string. */
export function parseSender(from: string): { email: string; name: string } | string | null {
  const named = from.match(/^\s*(.+?)\s*<([^>]+)>\s*$/);
  if (named?.[1] && named[2]) return { name: named[1], email: named[2].trim() };
  const bare = from.trim();
  return bare.includes('@') ? bare : null;
}
