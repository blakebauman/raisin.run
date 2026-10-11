import { invitation, organization, user } from '@raisin/db';
import { Alert, AlertDescription } from '@raisin/ui/alert';
import { Button } from '@raisin/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@raisin/ui/card';
import { eq } from 'drizzle-orm';
import { data, Form, Link, redirect } from 'react-router';
import { AuthShell } from '~/components/auth-shell';
import { getAuth } from '~/lib/auth.server';
import { db } from '~/lib/env.server';
import { getSession, requireMember, switchOrganization } from '~/lib/session.server';
import type { Route } from './+types/invite';

export function meta(): Route.MetaDescriptors {
  return [{ title: 'Join a team — Raisin' }];
}

async function loadInvitation(id: string) {
  const rows = await db()
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      orgId: invitation.organizationId,
      orgName: organization.name,
      inviter: user.name,
    })
    .from(invitation)
    .innerJoin(organization, eq(organization.id, invitation.organizationId))
    .innerJoin(user, eq(user.id, invitation.inviterId))
    .where(eq(invitation.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const invite = await loadInvitation(params.invitationId);
  if (invite?.status !== 'pending' || invite.expiresAt.getTime() < Date.now()) {
    return { state: 'invalid' as const };
  }
  const session = await getSession(request);
  const next = encodeURIComponent(`/invite/${invite.id}`);
  return {
    state: 'pending' as const,
    orgName: invite.orgName,
    inviter: invite.inviter,
    role: invite.role ?? 'member',
    email: invite.email,
    signedInAs: session?.user.email ?? null,
    signup: `/signup?next=${next}`,
    login: `/login?next=${next}`,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireMember(request);
  const invite = await loadInvitation(params.invitationId);
  if (!invite) throw new Response('Not found', { status: 404 });
  try {
    await getAuth().api.acceptInvitation({
      headers: request.headers,
      body: { invitationId: invite.id },
    });
  } catch (e) {
    return data(
      { error: e instanceof Error ? e.message : 'Could not accept the invitation.' },
      { status: 400 },
    );
  }
  const headers = await switchOrganization(request, invite.orgId);
  throw redirect('/app', { headers: headers ?? undefined });
}

export default function Invite({ loaderData, actionData }: Route.ComponentProps) {
  if (loaderData.state === 'invalid') {
    return (
      <AuthShell>
        <Card>
          <CardHeader>
            <CardTitle>Invitation not available</CardTitle>
            <CardDescription>
              It may have expired, been cancelled, or already been accepted.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/app">Go to the dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </AuthShell>
    );
  }
  const { orgName, inviter, role, email, signedInAs } = loaderData;
  const wrongAccount = signedInAs !== null && signedInAs.toLowerCase() !== email.toLowerCase();
  return (
    <AuthShell>
      <Card>
        <CardHeader>
          <CardTitle>Join {orgName}</CardTitle>
          <CardDescription>
            {inviter} invited {email} to join as {role === 'admin' ? 'an admin' : `a ${role}`}.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {actionData?.error && (
            <Alert variant="destructive">
              <AlertDescription>{actionData.error}</AlertDescription>
            </Alert>
          )}
          {signedInAs === null ? (
            <>
              <Button asChild>
                <Link to={loaderData.signup}>Create an account with {email}</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to={loaderData.login}>I already have an account</Link>
              </Button>
            </>
          ) : wrongAccount ? (
            <p className="text-sm text-muted-foreground">
              You're signed in as {signedInAs}. Sign in as {email} to accept this invitation.
            </p>
          ) : (
            <Form method="post">
              <Button type="submit" className="w-full">
                Accept and join {orgName}
              </Button>
            </Form>
          )}
        </CardContent>
      </Card>
    </AuthShell>
  );
}
