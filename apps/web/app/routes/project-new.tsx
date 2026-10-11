import { checkTarget, normalizeUrl } from '@raisin/core';
import { projects } from '@raisin/db';
import { Button } from '@raisin/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@raisin/ui/card';
import { Input } from '@raisin/ui/input';
import { eq, sql } from 'drizzle-orm';
import { data, Form, Link, redirect, useNavigation } from 'react-router';
import { Field } from '~/components/common';
import { db } from '~/lib/env.server';
import { newId, randomToken } from '~/lib/ids';
import { getPlan } from '~/lib/plans.server';
import { requireMember } from '~/lib/session.server';
import type { Route } from './+types/project-new';

export function meta(): Route.MetaDescriptors {
  return [{ title: 'New project — Raisin' }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireMember(request);
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const m = await requireMember(request);
  const form = await request.formData();
  let raw = String(form.get('url') ?? '').trim();
  if (raw && !/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  const startUrl = normalizeUrl(raw);
  const target = startUrl
    ? checkTarget(startUrl)
    : { ok: false as const, reason: 'Enter a valid URL' };
  if (!startUrl || !target.ok)
    return data({ error: target.ok ? 'Enter a valid URL' : target.reason }, { status: 400 });

  const plan = await getPlan(m.orgId);
  const database = db();
  const count = await database
    .select({ n: sql<number>`count(*)` })
    .from(projects)
    .where(eq(projects.organizationId, m.orgId));
  if ((count[0]?.n ?? 0) >= plan.maxProjects) {
    return data(
      { error: `The ${plan.name} plan allows ${plan.maxProjects} project(s).` },
      { status: 400 },
    );
  }
  const host = new URL(startUrl).hostname;
  const id = newId('prj');
  await database.insert(projects).values({
    id,
    organizationId: m.orgId,
    name: String(form.get('name') ?? '').trim() || host,
    host,
    startUrl,
    verificationToken: randomToken(16),
    createdBy: m.user.id,
  });
  throw redirect(`/app/projects/${id}`);
}

export default function ProjectNew({ actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== 'idle';
  return (
    <div className="mx-auto max-w-xl px-4 py-6 sm:px-8 sm:py-10">
      <Card>
        <CardHeader>
          <CardTitle>New project</CardTitle>
          <CardDescription>
            A project is one website. You can run as many crawls of it as your plan allows.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" className="grid gap-4">
            <Field
              id="url"
              label="Start URL"
              hint="The crawl starts here and stays on this host."
              error={actionData?.error}
            >
              <Input
                id="url"
                name="url"
                placeholder="https://www.example.com/"
                required
                autoFocus
              />
            </Field>
            <Field id="name" label="Name" hint="Optional. Defaults to the hostname.">
              <Input id="name" name="name" placeholder="Example marketing site" />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {busy ? 'Creating…' : 'Create project'}
              </Button>
              <Button asChild variant="ghost">
                <Link to="/app">Cancel</Link>
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
