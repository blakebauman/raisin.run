import { apiKeys } from '@raisin/db';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from './env.server';
import { newId, randomToken, sha256Hex } from './ids';

/** Create a key. The plaintext is returned once and only its hash is stored. */
export async function createApiKey(orgId: string, userId: string, name: string): Promise<string> {
  const key = `rsn_${randomToken(24)}`;
  await db()
    .insert(apiKeys)
    .values({
      id: newId('key'),
      organizationId: orgId,
      name,
      prefix: key.slice(0, 12),
      hash: await sha256Hex(key),
      createdBy: userId,
    });
  return key;
}

/** `Authorization: Bearer rsn_…` → the key's organization, or null. */
export async function authenticateApiKey(
  request: Request,
): Promise<{ orgId: string; keyId: string } | null> {
  const header = request.headers.get('authorization') ?? '';
  const key = header.match(/^Bearer\s+(rsn_[a-f0-9]{48})$/i)?.[1];
  if (!key) return null;
  const rows = await db()
    .select({ id: apiKeys.id, orgId: apiKeys.organizationId })
    .from(apiKeys)
    .where(and(eq(apiKeys.hash, await sha256Hex(key)), isNull(apiKeys.revokedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  await db().update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
  return { orgId: row.orgId, keyId: row.id };
}
