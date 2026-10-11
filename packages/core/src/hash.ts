/**
 * Content fingerprints. `contentHash` finds exact duplicates (same visible text after
 * whitespace and case folding). `simhash` finds near-duplicates without comparing every pair:
 * two pages whose 64-bit simhashes differ in ≤ 3 bits share at least one of four 16-bit bands
 * (pigeonhole), so the Crawl DO only compares pages that collide on a band.
 */

export async function contentHash(text: string): Promise<string> {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return [...new Uint8Array(digest).slice(0, 12)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const MASK64 = (1n << 64n) - 1n;

/** FNV-1a 64-bit over a string; cheap, well-distributed feature hash for simhash. */
function fnv1a64(s: string): bigint {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 0x100000001b3n) & MASK64;
  }
  return h;
}

/** 64-bit simhash over word 3-shingles, as 16 hex characters. Empty text hashes to all zeros. */
export function simhash(text: string): string {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const shingle = words.length >= 3 ? 3 : words.length;
  const features: string[] = [];
  for (let i = 0; i + shingle <= words.length && shingle > 0; i++) {
    features.push(words.slice(i, i + shingle).join(' '));
  }
  return featureSimhash(features);
}

/** 64-bit simhash over arbitrary feature strings, as 16 hex characters. No features → all zeros. */
export function featureSimhash(features: Iterable<string>): string {
  const weights = new Int32Array(64);
  let any = false;
  for (const feature of features) {
    any = true;
    let h = fnv1a64(feature);
    for (let bit = 0; bit < 64; bit++) {
      weights[bit]! += (h & 1n) === 1n ? 1 : -1;
      h >>= 1n;
    }
  }
  if (!any) return '0'.repeat(16);
  let out = 0n;
  for (let bit = 63; bit >= 0; bit--) {
    out = (out << 1n) | (weights[bit]! > 0 ? 1n : 0n);
  }
  return out.toString(16).padStart(16, '0');
}

export function hammingDistance(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (x > 0n) {
    x &= x - 1n;
    count++;
  }
  return count;
}

/** Four 16-bit bands of a simhash, stored as indexed integer columns for candidate lookup. */
export function simhashBands(hex: string): [number, number, number, number] {
  return [
    Number.parseInt(hex.slice(0, 4), 16),
    Number.parseInt(hex.slice(4, 8), 16),
    Number.parseInt(hex.slice(8, 12), 16),
    Number.parseInt(hex.slice(12, 16), 16),
  ];
}

/** Similarity percentage the UI shows for a simhash pair (64 − distance) / 64. */
export function simhashSimilarity(a: string, b: string): number {
  return Math.round(((64 - hammingDistance(a, b)) / 64) * 100);
}
