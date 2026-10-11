/**
 * Saving page-type corrections: write the project's names to D1, then group the crawl again so
 * the change shows straight away. Later crawls of the project pick the names up at analysis.
 */

import { loadPageTypeNames, pageTypeNames } from '@raisin/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Crawl } from './crawls.server';
import { db, engine } from './env.server';
import { type PageTypeEdit, planPageTypeEdit } from './page-type-edits';
import type { Member } from './session.server';

// D1 binds at most 100 parameters per statement: 5 per inserted row, 1 per deleted pattern.
const INSERT_CHUNK = 20;
const DELETE_CHUNK = 90;

export async function applyPageTypeEdit(
  m: Member,
  crawl: Crawl,
  edit: PageTypeEdit,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (crawl.status !== 'completed')
    return { ok: false, error: 'Page types can be changed once the crawl has finished.' };
  const [types, names] = await Promise.all([
    engine().pageTypes(m.orgId, crawl.id),
    loadPageTypeNames(db(), crawl.projectId),
  ]);
  const plan = planPageTypeEdit(types, names, edit);
  if ('error' in plan) return { ok: false, error: plan.error };

  const rows = Object.entries(plan.set).map(([pattern, name]) => ({
    projectId: crawl.projectId,
    pattern,
    name,
    updatedBy: m.user.id,
    updatedAt: new Date(),
  }));
  const statements = [];
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    statements.push(
      db()
        .insert(pageTypeNames)
        .values(rows.slice(i, i + INSERT_CHUNK))
        .onConflictDoUpdate({
          target: [pageTypeNames.projectId, pageTypeNames.pattern],
          set: {
            name: sql`excluded.name`,
            updatedBy: sql`excluded.updated_by`,
            updatedAt: sql`excluded.updated_at`,
          },
        }),
    );
  }
  for (let i = 0; i < plan.clear.length; i += DELETE_CHUNK) {
    statements.push(
      db()
        .delete(pageTypeNames)
        .where(
          and(
            eq(pageTypeNames.projectId, crawl.projectId),
            inArray(pageTypeNames.pattern, plan.clear.slice(i, i + DELETE_CHUNK)),
          ),
        ),
    );
  }
  const [first, ...rest] = statements;
  if (first) await db().batch([first, ...rest]);

  await engine().regroupPageTypes(
    m.orgId,
    crawl.id,
    await loadPageTypeNames(db(), crawl.projectId),
  );
  return { ok: true };
}
