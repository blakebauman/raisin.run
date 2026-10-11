/**
 * SERP pixel widths. Google truncates titles and descriptions by rendered width, not characters,
 * so both are reported. Widths use Arial advance widths (identical to Helvetica's AFM
 * metrics) in 1/1000 em, scaled to Google's desktop sizes: titles at 20px, snippets at 14px.
 */

// Advance widths for printable ASCII 0x20–0x7E, in order.
const ASCII_WIDTHS = [
  278,
  278,
  355,
  556,
  556,
  889,
  667,
  191,
  333,
  333,
  389,
  584,
  278,
  333,
  278,
  278, // space–/
  556,
  556,
  556,
  556,
  556,
  556,
  556,
  556,
  556,
  556, // 0–9
  278,
  278,
  584,
  584,
  584,
  556,
  1015, // :;<=>?@
  667,
  667,
  722,
  722,
  667,
  611,
  778,
  722,
  278,
  500,
  667,
  556,
  833, // A–M
  722,
  778,
  667,
  778,
  722,
  667,
  611,
  722,
  667,
  944,
  667,
  667,
  611, // N–Z
  278,
  278,
  278,
  469,
  556,
  333, // [\]^_`
  556,
  556,
  500,
  556,
  556,
  278,
  556,
  556,
  222,
  222,
  500,
  222,
  833, // a–m
  556,
  556,
  556,
  556,
  333,
  500,
  278,
  556,
  500,
  722,
  500,
  500,
  500, // n–z
  334,
  260,
  334,
  584, // {|}~
];

/** Average width for characters outside the table (accented Latin, CJK is wider still). */
const FALLBACK_WIDTH = 556;
const WIDE_WIDTH = 1000;

function charWidth(code: number): number {
  if (code >= 0x20 && code <= 0x7e) return ASCII_WIDTHS[code - 0x20] ?? FALLBACK_WIDTH;
  // CJK, Hangul, fullwidth forms render at a full em.
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xff60)
  ) {
    return WIDE_WIDTH;
  }
  return FALLBACK_WIDTH;
}

export function pixelWidth(text: string, fontSizePx: number): number {
  let units = 0;
  for (const ch of text) units += charWidth(ch.codePointAt(0) ?? 0x20);
  return Math.round((units * fontSizePx) / 1000);
}

export const TITLE_FONT_PX = 20;
export const DESCRIPTION_FONT_PX = 14;
/** Default thresholds: titles 30–60 chars / 200–561px, descriptions 70–155 chars / 400–985px. */
export const SERP_LIMITS = {
  title: { minChars: 30, maxChars: 60, minPx: 200, maxPx: 561 },
  description: { minChars: 70, maxChars: 155, minPx: 400, maxPx: 985 },
} as const;

export const titleWidth = (t: string) => pixelWidth(t, TITLE_FONT_PX);
export const descriptionWidth = (d: string) => pixelWidth(d, DESCRIPTION_FONT_PX);

/** Truncate the way the SERP preview shows it, with an ellipsis once the pixel budget runs out. */
export function truncateToWidth(text: string, maxPx: number, fontSizePx: number): string {
  const ellipsis = pixelWidth('...', fontSizePx);
  if (pixelWidth(text, fontSizePx) <= maxPx) return text;
  let out = '';
  let units = 0;
  for (const ch of text) {
    const next = units + charWidth(ch.codePointAt(0) ?? 0x20);
    if ((next * fontSizePx) / 1000 + ellipsis > maxPx) break;
    units = next;
    out += ch;
  }
  return `${out.trimEnd()}...`;
}
