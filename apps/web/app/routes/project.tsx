import { crawls, projects, schedules } from '@raisin/db';
import { Alert, AlertDescription } from '@raisin/ui/alert';
import { Button } from '@raisin/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@raisin/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@raisin/ui/collapsible';
import { NativeSelect, NativeSelectOption } from '@raisin/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@raisin/ui/table';
import { and, desc, eq } from 'drizzle-orm';
import { BadgeCheck, ChevronDown, Play, ShieldCheck } from 'lucide-react';
import { data, Form, Link, redirect, useNavigation, useSearchParams } from 'react-router';
import { DateTime, EmptyState, StatusPill } from '~/components/common';
import { ConfirmDelete } from '~/components/confirm-delete';
import { CrawlConfigFields } from '~/components/crawl-config-form';
import { parseConfigForm } from '~/lib/config-form';
import { effectiveConfig, getProject, LimitError, startCrawl } from '~/lib/crawls.server';
import { db, engine } from '~/lib/env.server';
import { newId } from '~/lib/ids';
import { getPlan, UNVERIFIED_LIMITS } from '~/lib/plans.server';
import { type Frequency, nextRun } from '~/lib/schedule-time';
import { canManage, requireMember } from '~/lib/session.server';
import { verificationInstructions, verifyProject } from '~/lib/verify.server';
import type { Route } from './+types/project';

export function meta({ loaderData: data }: Route.MetaArgs): Route.MetaDescriptors {
  return [{ title: `${data?.project.name ?? 'Project'} — Raisin` }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const m = await requireMember(request);
  const project = await getProject(m.orgId, params.projectId);
  if (!project) throw new Response('Not found', { status: 404 });
  const database = db();
  const [{ config, plan }, crawlRows, scheduleRows] = await Promise.all([
    effectiveConfig(m.orgId, project),
    database
      .select()
      .from(crawls)
      .where(eq(crawls.projectId, project.id))
      .orderBy(desc(crawls.createdAt))
      .limit(50),
    database.select().from(schedules).where(eq(schedules.projectId, project.id)).limit(1),
  ]);
  const verified = project.verifiedAt !== null;
  return {
    project: {
      id: project.id,
      name: project.name,
      host: project.host,
      startUrl: project.startUrl,
      verified,
      verifiedMethod: project.verifiedMethod,
    },
    verification: verified ? null : verificationInstructions(project),
    config,
    caps: {
      rendering: plan.rendering,
      ai: plan.ai,
      verified,
      maxUrls: verified
        ? plan.maxUrlsPerCrawl
        : Math.min(plan.maxUrlsPerCrawl, UNVERIFIED_LIMITS.maxUrls),
      maxRate: verified
        ? plan.maxUrlsPerSecond
        : Math.min(plan.maxUrlsPerSecond, UNVERIFIED_LIMITS.maxUrlsPerSecond),
    },
    planMaxUrls: plan.maxUrlsPerCrawl,
    planMaxRate: plan.maxUrlsPerSecond,
    schedulesAllowed: plan.schedules,
    schedule: scheduleRows[0] ?? null,
    crawls: crawlRows.map((c) => ({
      id: c.id,
      status: c.status,
      trigger: c.trigger,
      urlsCrawled: c.urlsCrawled,
      createdAt: c.createdAt,
      finishedAt: c.finishedAt,
      error: c.error,
      summary: c.summaryJson
        ? (JSON.parse(c.summaryJson) as { issue: number; warning: number; opportunity: number })
        : null,
    })),
    canManage: canManage(m),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const m = await requireMember(request);
  const project = await getProject(m.orgId, params.projectId);
  if (!project) throw new Response('Not found', { status: 404 });
  const form = await request.formData();
  const intent = form.get('intent');
  const database = db();

  if (intent === 'start' || intent === 'save') {
    const overrides = parseConfigForm(form);
    await database
      .update(projects)
      .set({ configJson: JSON.stringify(overrides) })
      .where(eq(projects.id, project.id));
    if (intent === 'save') return data({ ok: 'Settings saved.' });
    try {
      const { crawlId } = await startCrawl({
        orgId: m.orgId,
        userId: m.user.id,
        project,
        overrides,
        trigger: 'manual',
      });
      throw redirect(`/app/crawls/${crawlId}`);
    } catch (e) {
      if (e instanceof LimitError) return data({ error: e.message }, { status: 400 });
      throw e;
    }
  }
  if (intent === 'verify') {
    const method = await verifyProject(project);
    return method
      ? data({
          ok: `Verified with ${method === 'dns' ? 'a DNS TXT record' : method === 'meta' ? 'the meta tag' : 'the verification file'}.`,
        })
      : data(
          {
            error: 'No verification token found yet. DNS changes can take a few minutes to appear.',
          },
          { status: 400 },
        );
  }
  if (intent === 'schedule') {
    const plan = await getPlan(m.orgId);
    if (!plan.schedules)
      return data(
        { error: `Scheduled crawls are not included in the ${plan.name} plan.` },
        { status: 400 },
      );
    const frequency = String(form.get('frequency'));
    if (frequency === 'off') {
      await database.delete(schedules).where(eq(schedules.projectId, project.id));
      return data({ ok: 'Schedule removed.' });
    }
    if (!['daily', 'weekly', 'monthly'].includes(frequency))
      return data({ error: 'Pick a frequency.' }, { status: 400 });
    const hourUtc = Math.max(0, Math.min(23, Number(form.get('hourUtc') ?? 3)));
    const next = nextRun(frequency as Frequency, hourUtc);
    await database
      .insert(schedules)
      .values({
        id: newId('sch'),
        organizationId: m.orgId,
        projectId: project.id,
        frequency: frequency as Frequency,
        hourUtc,
        nextRunAt: next,
      })
      .onConflictDoUpdate({
        target: schedules.projectId,
        set: { frequency: frequency as Frequency, hourUtc, nextRunAt: next, enabled: true },
      });
    return data({ ok: `Next crawl: ${next.toUTCString()}.` });
  }
  if (intent === 'delete') {
    if (!canManage(m))
      return data({ error: 'Only owners and admins can delete projects.' }, { status: 403 });
    const rows = await database
      .select({ id: crawls.id })
      .from(crawls)
      .where(eq(crawls.projectId, project.id));
    await Promise.all(
      rows.map((c) =>
        engine()
          .purge(m.orgId, c.id)
          .catch(() => {}),
      ),
    );
    await database
      .delete(projects)
      .where(and(eq(projects.id, project.id), eq(projects.organizationId, m.orgId)));
    throw redirect('/app');
  }
  return data({ error: 'Unknown action' }, { status: 400 });
}

export default function ProjectPage({ loaderData, actionData }: Route.ComponentProps) {
  const { project, crawls: crawlRows, config, caps } = loaderData;
  const busy = useNavigation().state !== 'idle';
  const [params] = useSearchParams();
  const message = actionData && 'ok' in actionData ? actionData.ok : null;
  const error = actionData && 'error' in actionData ? actionData.error : null;
  // The crawl view's limit notice links here with the relevant section open.
  const settingsOpen = params.get('settings') === 'open';
  const verifyOpen = params.get('verify') === 'open' || Boolean(error && !project.verified);
  const unlocks =
    loaderData.planMaxUrls > caps.maxUrls || loaderData.planMaxRate > caps.maxRate
      ? `up to ${loaderData.planMaxUrls.toLocaleString()} URLs at ${loaderData.planMaxRate.toLocaleString()} per second`
      : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link to="/app" className="hover:underline">
              Projects
            </Link>
          </p>
          <h1 className="mt-1 flex items-center gap-2 text-xl font-semibold">
            {project.name}
            {project.verified && (
              <BadgeCheck className="size-5 text-primary" aria-label="Verified" />
            )}
          </h1>
          <a
            href={project.startUrl}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-muted-foreground hover:underline"
          >
            {project.startUrl}
          </a>
        </div>
      </div>

      {(message || error) && (
        <Alert variant={error ? 'destructive' : 'default'} className="mt-6">
          <AlertDescription>{error ?? message}</AlertDescription>
        </Alert>
      )}

      <Card className="mt-6">
        <Form method="post">
          <CardHeader>
            <CardTitle>Run a crawl</CardTitle>
            <CardDescription>
              Starts at {project.startUrl} and follows links on {project.host}.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <Collapsible defaultOpen={settingsOpen}>
              <CollapsibleTrigger className="group flex items-center gap-1 text-sm font-medium text-primary">
                Crawl settings
                <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-5">
                <CrawlConfigFields config={config} caps={caps} />
              </CollapsibleContent>
            </Collapsible>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" name="intent" value="start" disabled={busy}>
                <Play />
                Start crawl
              </Button>
              <Button type="submit" name="intent" value="save" variant="outline" disabled={busy}>
                Save settings
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              RaisinBot requests up to {config.maxUrls.toLocaleString()} URLs at{' '}
              {config.maxUrlsPerSecond.toLocaleString()} per second
              {config.respectRobots ? ', follows robots.txt' : ''} and backs off if the server
              pushes back.{' '}
              <Link to="/bot" className="text-primary hover:underline">
                How RaisinBot behaves
              </Link>
            </p>
          </CardContent>
        </Form>
      </Card>

      {!project.verified && loaderData.verification && (
        <Card className="mt-6 gap-4" id="verify">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-muted-foreground" aria-hidden />
              Verify {project.host}
            </CardTitle>
            <CardDescription>
              Until you prove you own this site, crawls are limited to{' '}
              {caps.maxUrls.toLocaleString()} URLs at {caps.maxRate.toLocaleString()} per second and
              always follow robots.txt.
              {unlocks && ` Verifying lets you crawl ${unlocks}.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Collapsible defaultOpen={verifyOpen}>
              <CollapsibleTrigger className="group flex items-center gap-1 rounded-sm text-sm font-medium text-primary">
                Ways to verify
                <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="grid gap-4 pt-4 text-sm">
                <p className="text-muted-foreground">Use any one of these, then check below.</p>
                <div>
                  <p className="font-medium">DNS TXT record</p>
                  <p className="mt-1 text-muted-foreground">
                    Name{' '}
                    <code className="rounded bg-muted px-1 font-mono text-xs">
                      {loaderData.verification.dns.name}
                    </code>
                    , value{' '}
                    <code className="rounded bg-muted px-1 font-mono text-xs break-all">
                      {loaderData.verification.dns.value}
                    </code>
                    . DNS changes can take a few minutes to appear.
                  </p>
                </div>
                <div>
                  <p className="font-medium">Meta tag on the start URL</p>
                  <code className="mt-1 block overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-xs">
                    {loaderData.verification.meta}
                  </code>
                </div>
                <div>
                  <p className="font-medium">File</p>
                  <p className="mt-1 text-muted-foreground">
                    Serve{' '}
                    <code className="rounded bg-muted px-1 font-mono text-xs break-all">
                      {loaderData.verification.file.content}
                    </code>{' '}
                    at{' '}
                    <code className="rounded bg-muted px-1 font-mono text-xs break-all">
                      {loaderData.verification.file.url}
                    </code>
                  </p>
                </div>
                <Form method="post">
                  <Button
                    type="submit"
                    name="intent"
                    value="verify"
                    variant="outline"
                    disabled={busy}
                  >
                    Check verification
                  </Button>
                </Form>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
          <CardDescription>
            {loaderData.schedulesAllowed ? (
              loaderData.schedule ? (
                <>
                  Runs {loaderData.schedule.frequency}; next{' '}
                  <DateTime value={loaderData.schedule.nextRunAt} />.
                </>
              ) : (
                'Re-crawl automatically with the saved settings.'
              )
            ) : (
              'Scheduled crawls are available on Pro and Agency plans.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" className="flex flex-wrap items-end gap-2">
            <label htmlFor="frequency" className="sr-only">
              Frequency
            </label>
            <NativeSelect
              id="frequency"
              name="frequency"
              defaultValue={loaderData.schedule?.frequency ?? 'off'}
              disabled={!loaderData.schedulesAllowed}
            >
              <NativeSelectOption value="off">Off</NativeSelectOption>
              <NativeSelectOption value="daily">Daily</NativeSelectOption>
              <NativeSelectOption value="weekly">Weekly (Mondays)</NativeSelectOption>
              <NativeSelectOption value="monthly">Monthly (1st)</NativeSelectOption>
            </NativeSelect>
            <label htmlFor="hourUtc" className="sr-only">
              Time (UTC)
            </label>
            <NativeSelect
              id="hourUtc"
              name="hourUtc"
              defaultValue={String(loaderData.schedule?.hourUtc ?? 3)}
              disabled={!loaderData.schedulesAllowed}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <NativeSelectOption key={h} value={String(h)}>
                  {String(h).padStart(2, '0')}:00 UTC
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Button
              type="submit"
              name="intent"
              value="schedule"
              variant="outline"
              disabled={busy || !loaderData.schedulesAllowed}
            >
              Save
            </Button>
          </Form>
        </CardContent>
      </Card>

      <Card className="mt-6 gap-0 pb-0">
        <CardHeader className="pb-4">
          <CardTitle>Crawls</CardTitle>
        </CardHeader>
        {crawlRows.length === 0 ? (
          <EmptyState title="No crawls yet">
            Start one above. Results appear while it runs.
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Started</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">URLs</TableHead>
                <TableHead className="text-right">Issues</TableHead>
                <TableHead className="text-right">Warnings</TableHead>
                <TableHead className="pr-6 text-right">Opportunities</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {crawlRows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="pl-6">
                    <Link to={`/app/crawls/${c.id}`} className="font-medium hover:underline">
                      <span className="sr-only">Crawl started </span>
                      <DateTime value={c.createdAt} />
                    </Link>
                    {c.trigger !== 'manual' && (
                      <span className="ml-2 text-xs text-muted-foreground">{c.trigger}</span>
                    )}
                    {c.error && (
                      <p className="line-clamp-2 max-w-md text-xs text-destructive" title={c.error}>
                        {c.error}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusPill status={c.status} />
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {c.urlsCrawled.toLocaleString()}
                  </TableCell>
                  <TableCell className="tabular text-right text-issue">
                    {c.summary?.issue ?? '—'}
                  </TableCell>
                  <TableCell className="tabular text-right text-warning">
                    {c.summary?.warning ?? '—'}
                  </TableCell>
                  <TableCell className="tabular pr-6 text-right text-opportunity">
                    {c.summary?.opportunity ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {loaderData.canManage && (
        <section
          aria-labelledby="danger-zone"
          className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t pt-6"
        >
          <div className="max-w-xl">
            <h2 id="danger-zone" className="font-semibold">
              Delete this project
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Deletes every crawl, export and stored page of {project.name}. This can't be undone.
            </p>
          </div>
          <ConfirmDelete
            title={`Delete ${project.name}?`}
            description={`Every crawl, export and stored page of this project will be deleted. Schedules stop. This can't be undone.`}
            action="Delete project"
            confirmText={project.name}
            trigger={
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                Delete project
              </Button>
            }
          />
        </section>
      )}
    </div>
  );
}
