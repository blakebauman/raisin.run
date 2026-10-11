/**
 * Better Auth on D1 (through Drizzle), with email/password, optional Google sign-in, and the
 * organization plugin. Every new user gets a personal organization on the Free plan, and every
 * new session starts in the user's first organization.
 */

import { env } from 'cloudflare:workers';
import { invitationEmail, verificationEmail } from '@raisin/core';
import { authSchema, member, organization, orgPlans } from '@raisin/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { organization as organizationPlugin } from 'better-auth/plugins';
import { asc, eq } from 'drizzle-orm';
import { sendEmail } from './email.server';
import { db } from './env.server';
import { newId } from './ids';

function createAuth() {
  const database = db();
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_URL,
    basePath: '/api/auth',
    database: drizzleAdapter(database, { provider: 'sqlite', schema: authSchema }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      // Unverified accounts can't sign in. Without this, anyone holding an invite link could sign
      // up as the invitee's address and join their team. Google accounts arrive verified.
      requireEmailVerification: true,
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail(user.email, verificationEmail({ name: user.name, link: url }));
      },
    },
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
        : {},
    plugins: [
      organizationPlugin({
        creatorRole: 'owner',
        // Organizations are created only by the sign-up hook below (with a plan row). Letting
        // users call Better Auth's create endpoint would hand out fresh Free quotas on demand.
        allowUserToCreateOrganization: false,
        requireEmailVerificationOnInvitation: true,
        sendInvitationEmail: async ({ id, email, role, organization, inviter }) => {
          await sendEmail(
            email,
            invitationEmail({
              orgName: organization.name,
              inviterName: inviter.user.name || inviter.user.email,
              role: Array.isArray(role) ? (role[0] ?? 'member') : role,
              link: `${env.APP_URL}/invite/${id}`,
            }),
          );
        },
      }),
    ],
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      // A signed copy of the session rides in a cookie for 5 minutes, so most requests skip D1.
      // The cost: revoking a session elsewhere takes up to 5 minutes to bite on this device.
      // Anything that changes session fields must go through Better Auth (setActiveOrganization),
      // which refreshes this cookie; writing the session table directly would leave it stale.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-up/email' || !env.TURNSTILE_SECRET_KEY) return;
        const token = ctx.headers?.get('x-turnstile-token');
        if (
          !token ||
          !(await verifyTurnstile(token, ctx.headers?.get('cf-connecting-ip') ?? null))
        ) {
          throw new APIError('BAD_REQUEST', {
            message: 'Please complete the challenge and try again.',
          });
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            const orgId = newId('org');
            const base = (user.name || user.email.split('@')[0] || 'team')
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '')
              .slice(0, 32);
            await database.batch([
              database.insert(organization).values({
                id: orgId,
                name: user.name ? `${user.name}'s team` : 'My team',
                slug: `${base || 'team'}-${orgId.slice(-6)}`,
              }),
              database.insert(member).values({
                id: newId('mem'),
                organizationId: orgId,
                userId: user.id,
                role: 'owner',
              }),
              database.insert(orgPlans).values({ organizationId: orgId, planId: 'free' }),
            ]);
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const first = await database
              .select({ organizationId: member.organizationId })
              .from(member)
              .where(eq(member.userId, session.userId))
              .orderBy(asc(member.createdAt))
              .limit(1);
            return { data: { ...session, activeOrganizationId: first[0]?.organizationId ?? null } };
          },
        },
      },
    },
  });
}

let instance: ReturnType<typeof createAuth> | null = null;

export function getAuth() {
  instance ??= createAuth();
  return instance;
}

async function verifyTurnstile(token: string, ip: string | null): Promise<boolean> {
  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET_KEY ?? '');
  body.append('response', token);
  if (ip) body.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
  });
  const out = (await res.json()) as { success: boolean };
  return out.success;
}
