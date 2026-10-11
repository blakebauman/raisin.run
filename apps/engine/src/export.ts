/**
 * CSV exports to R2. Rows are paged out of the Crawl DO a thousand at a time and streamed into
 * an R2 multipart upload, so a 400k-row export never sits in memory at once.
 */

import { csvRow, type GridQuery } from '@raisin/core';

type Grid = (q: GridQuery) => Promise<{
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
  total: number;
}>;

const PAGE = 1_000;
/** R2 multipart parts must be at least 5 MiB, except the last. */
const PART_BYTES = 6 * 1024 * 1024;

export async function exportCsv(
  bucket: R2Bucket,
  key: string,
  grid: Grid,
  q: Pick<GridQuery, 'tab' | 'filter' | 'search'>,
): Promise<number> {
  const encoder = new TextEncoder();
  const upload = await bucket.createMultipartUpload(key, {
    httpMetadata: { contentType: 'text/csv; charset=utf-8' },
  });
  const parts: R2UploadedPart[] = [];
  let buffer: string[] = [];
  let bufferBytes = 0;
  let rows = 0;

  const flush = async (final: boolean) => {
    if (!buffer.length || (!final && bufferBytes < PART_BYTES)) return;
    parts.push(await upload.uploadPart(parts.length + 1, encoder.encode(buffer.join(''))));
    buffer = [];
    bufferBytes = 0;
  };
  const push = (line: string) => {
    buffer.push(line);
    bufferBytes += line.length * 2;
  };

  try {
    for (let offset = 0; ; offset += PAGE) {
      const page = await grid({ ...q, offset, limit: PAGE });
      if (offset === 0) push(csvRow(page.columns.map((c) => c.label)));
      for (const row of page.rows) {
        push(csvRow(page.columns.map((c) => row[c.key])));
      }
      rows += page.rows.length;
      await flush(false);
      if (page.rows.length < PAGE) break;
    }
    await flush(true);
    await upload.complete(parts);
  } catch (e) {
    await upload.abort();
    throw e;
  }
  return rows;
}
