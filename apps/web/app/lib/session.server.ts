import { member, organization } from '@raisin/db';
import { asc, eq } from 'drizzle-orm';
import { redirect } from 'react-router';
import { getAuth } from './auth.server';
import { db } from './env.server';

export type Member = {
  user: { id: string; name: string; email: string; image?: string | null };
  sessionId: string;
  orgId: string;
  orgName: string;
  role: string;
  orgs: { id: string; name: string }[];
};

export async function getSession(request: Request) {
  return getAuth().api.getSession({ headers: request.headers });
}

/**
 * The signed-in user and their active organization, or a redirect to /login.
 */
export async function requireMember(request: Request): Promise<Member> {
  const current = await getSession(request);
  if (!current) {
    const url = new URL(request.url);
    throw redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }
  const database = db();
  const activeId =
    (current.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;
  const memberships = await database
    .select({ orgId: member.organizationId, role: member.role, orgName: organization.name })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, current.user.id))
    .orderBy(asc(member.createdAt));
  const active = memberships.find((m) => m.orgId === activeId) ?? memberships[0];
  if (!active) throw redirect('/login?error=no-organization');
  // If the active organization is gone (membership removed), fall back to the first one for this
  // request. Nothing is written here: the session lives in a cookie cache too, and only Better
  // Auth's own endpoints keep the two in step. The next switch persists a valid choice.
  return {
    user: current.user,
    sessionId: current.session.id,
    orgId: active.orgId,
    orgName: active.orgName,
    role: active.role,
    orgs: memberships.map((o) => ({ id: o.orgId, name: o.orgName })),
  };
}

/**
 * Make `orgId` the session's active organization. Goes through Better Auth so its cookie cache
 * is refreshed too; returns the Set-Cookie headers to send back, or null if the user isn't a
 * member (Better Auth checks membership).
 */
export async function switchOrganization(request: Request, orgId: string): Promise<Headers | null> {
  const res = await getAuth().api.setActiveOrganization({
    headers: request.headers,
    body: { organizationId: orgId },
    asResponse: true,
  });
  if (!res.ok) return null;
  const headers = new Headers();
  for (const cookie of res.headers.getSetCookie()) headers.append('set-cookie', cookie);
  return headers;
}

export function canManage(m: Member): boolean {
  return m.role === 'owner' || m.role === 'admin';
}
