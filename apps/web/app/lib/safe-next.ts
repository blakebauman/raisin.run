/** Only same-origin paths are honoured as a post-login destination. */
export function safeNext(next: string | null): string {
  return next?.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/app';
}
