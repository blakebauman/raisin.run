import { env } from 'cloudflare:workers';
import { apiKeys, invitation, member, notificationPrefs, plans, user } from '@raisin/db';
import { Alert, AlertDescription, AlertTitle } from '@raisin/ui/alert';
import { Button } from '@raisin/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@raisin/ui/card';
import { Input } from '@raisin/ui/input';
import { Label } from '@raisin/ui/label';
import { NativeSelect, NativeSelectOption } from '@raisin/ui/native-select';
import { Progress } from '@raisin/ui/progress';
import { Switch } from '@raisin/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@raisin/ui/table';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { useState } from 'react';
import { data, Form, useFetcher, useNavigation, useSearchParams } from 'react-router';
import { DateTime } from '~/components/common';
import { createApiKey } from '~/lib/api-keys.server';
import { getAuth } from '~/lib/auth.server';
import { billingState, planPrices } from '~/lib/billing.server';
import { db } from '~/lib/env.server';
import { getPlan, getUsage } from '~/lib/plans.server';
import { canManage, requireMember } from '~/lib/session.server';
import type { Route } from './+types/settings';

export function meta(): Route.MetaDescriptors {
  return [{ title: 'Settings — Raisin' }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const m = await requireMember(request);
  const database = db();
  const [plan, used, keys, members, invites, billing, prices, allPlans] = await Promise.all([
    getPlan(m.orgId),
    getUsage(m.orgId),
    database
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.organizationId, m.orgId), isNull(apiKeys.revokedAt)))
      .orderBy(desc(apiKeys.createdAt)),
    database
      .select({ name: user.name, email: user.email, role: member.role, joined: member.createdAt })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, m.orgId)),
    database
      .select({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
      })
      .from(invitation)
      .where(
        and(
          eq(invitation.organizationId, m.orgId),
          eq(invitation.status, 'pending'),
          gt(invitation.expiresAt, new Date()),
        ),
      ),
    billingState(m.orgId),
    planPrices(),
    database.select().from(plans),
  ]);
  const prefs = await database
    .select({ crawlFinished: notificationPrefs.crawlFinished })
    .from(notificationPrefs)
    .where(eq(notificationPrefs.userId, m.user.id))
    .limit(1);
  return {
    orgName: m.orgName,
    plan,
    billing,
    paidPlans: allPlans
      .filter((p) => p.id !== 'free')
      .sort((a, b) => a.maxUrlsPerCrawl - b.maxUrlsPerCrawl)
      .map((p) => ({ ...p, price: prices[p.id] ?? null })),
    used,
    keys,
    members,
    invites: invites.map((i) => ({ ...i, link: inviteLink(i.id) })),
    notifications: { crawlFinished: prefs[0]?.crawlFinished ?? true },
    canManage: canManage(m),
  };
}

function inviteLink(id: string): string {
  return `${env.APP_URL}/invite/${id}`;
}

export async function action({ request }: Route.ActionArgs) {
  const m = await requireMember(request);
  const form = await request.formData();
  const intent = form.get('intent');
  // Everyone manages their own email preferences; the rest of this page is owners and admins.
  if (intent === 'notifications') {
    const crawlFinished = form.get('crawlFinished') === 'on';
    await db()
      .insert(notificationPrefs)
      .values({ userId: m.user.id, crawlFinished })
      .onConflictDoUpdate({
        target: notificationPrefs.userId,
        set: { crawlFinished, updatedAt: new Date() },
      });
    return data({ ok: true });
  }
  if (!canManage(m)) {
    return data({ error: 'Only owners and admins can change settings.' }, { status: 403 });
  }
  if (intent === 'invite') {
    const email = String(form.get('email') ?? '')
      .trim()
      .toLowerCase();
    const role = form.get('role') === 'admin' ? 'admin' : 'member';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return data({ error: 'Enter a valid email address.' }, { status: 400 });
    }
    try {
      const invite = await getAuth().api.createInvitation({
        headers: request.headers,
        body: { email, role, organizationId: m.orgId },
      });
      return data({ invited: email, link: inviteLink(invite.id) });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not create the invitation.';
      return data({ error: message }, { status: 400 });
    }
  }
  if (intent === 'cancel-invite') {
    await db()
      .update(invitation)
      .set({ status: 'canceled' })
      .where(
        and(eq(invitation.id, String(form.get('id'))), eq(invitation.organizationId, m.orgId)),
      );
    return data({ ok: true });
  }
  if (intent === 'create-key') {
    const plan = await getPlan(m.orgId);
    if (!plan.api)
      return data(
        { error: `API access is not included in the ${plan.name} plan.` },
        { status: 403 },
      );
    const name = String(form.get('name') ?? '').trim() || 'API key';
    return data({ key: await createApiKey(m.orgId, m.user.id, name) });
  }
  if (intent === 'revoke-key') {
    await db()
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, String(form.get('id'))), eq(apiKeys.organizationId, m.orgId)));
    return data({ ok: true });
  }
  return data({ error: 'Unknown action' }, { status: 400 });
}

export default function Settings({ loaderData, actionData }: Route.ComponentProps) {
  const { plan, used } = loaderData;
  const busy = useNavigation().state !== 'idle';
  const meters = [
    { label: 'URLs crawled', used: used.crawledUrls, limit: plan.monthlyUrls },
    { label: 'Pages rendered', used: used.renderedPages, limit: plan.monthlyRenderedPages },
    { label: 'AI calls', used: used.aiCalls, limit: plan.monthlyAiCalls },
  ];
  return (
    <div className="mx-auto grid max-w-4xl gap-6 px-4 py-6 sm:px-8 sm:py-8">
      <h1 className="text-xl font-semibold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>{plan.name} plan</CardTitle>
          <CardDescription>
            {plan.maxUrlsPerCrawl.toLocaleString()} URLs per crawl · {plan.maxProjects} projects ·{' '}
            {plan.maxConcurrentCrawls} concurrent crawls · results kept {plan.retentionDays} days
            {plan.rendering ? ' · JavaScript rendering' : ''}
            {plan.ai ? ' · AI' : ''}
            {plan.schedules ? ' · schedules' : ''}
            {plan.api ? ' · API' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <BillingNotice billing={loaderData.billing} />
          <div className="grid gap-4 sm:grid-cols-3">
            {meters.map((meter) => (
              <div key={meter.label}>
                <p className="text-sm">{meter.label} this month</p>
                <p className="tabular mt-1 text-sm text-muted-foreground">
                  {meter.used.toLocaleString()} / {meter.limit.toLocaleString()}
                </p>
                <Progress
                  value={meter.limit ? Math.min(100, (meter.used / meter.limit) * 100) : 0}
                  className="mt-2 h-1.5"
                />
              </div>
            ))}
          </div>
          {loaderData.billing.enabled && loaderData.canManage && (
            <PlanPicker
              current={plan.id}
              plans={loaderData.paidPlans}
              billing={loaderData.billing}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>API keys</CardTitle>
          <CardDescription>
            Use <code className="font-mono text-xs">Authorization: Bearer &lt;key&gt;</code> with{' '}
            <code className="font-mono text-xs">/api/v1</code>.
            {!plan.api && ' Available on the Agency plan.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {actionData && 'key' in actionData && (
            <Alert>
              <AlertTitle>Copy your new key now</AlertTitle>
              <AlertDescription>
                <code className="font-mono text-xs break-all">{actionData.key}</code>
                <span>It won't be shown again.</span>
              </AlertDescription>
            </Alert>
          )}
          {actionData && 'error' in actionData && (
            <Alert variant="destructive">
              <AlertDescription>{actionData.error}</AlertDescription>
            </Alert>
          )}
          {loaderData.keys.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loaderData.keys.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell>{k.name}</TableCell>
                    <TableCell className="font-mono text-xs">{k.prefix}…</TableCell>
                    <TableCell>
                      <DateTime value={k.createdAt} />
                    </TableCell>
                    <TableCell>
                      <DateTime value={k.lastUsedAt} />
                    </TableCell>
                    <TableCell className="text-right">
                      {loaderData.canManage && (
                        <Form method="post">
                          <input type="hidden" name="id" value={k.id} />
                          <Button
                            type="submit"
                            name="intent"
                            value="revoke-key"
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                          >
                            Revoke
                          </Button>
                        </Form>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {loaderData.canManage && plan.api && (
            <Form method="post" className="flex gap-2">
              <Input name="name" placeholder="Key name, e.g. Looker Studio" className="max-w-xs" />
              <Button type="submit" name="intent" value="create-key" disabled={busy}>
                Create key
              </Button>
            </Form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Email notifications</CardTitle>
          <CardDescription>These apply to you, in every team you belong to.</CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationPrefs crawlFinished={loaderData.notifications.crawlFinished} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members of {loaderData.orgName}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loaderData.members.map((mem) => (
                <TableRow key={mem.email}>
                  <TableCell>{mem.name}</TableCell>
                  <TableCell>{mem.email}</TableCell>
                  <TableCell className="capitalize">{mem.role}</TableCell>
                  <TableCell>
                    <DateTime value={mem.joined} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {loaderData.invites.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium">Pending invitations</p>
              <ul className="mt-2 divide-y rounded-md border text-sm">
                {loaderData.invites.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate">
                      {i.email}{' '}
                      <span className="text-muted-foreground">· {i.role ?? 'member'}</span>
                    </span>
                    <CopyLink link={i.link} />
                    {loaderData.canManage && (
                      <Form method="post">
                        <input type="hidden" name="id" value={i.id} />
                        <Button
                          type="submit"
                          name="intent"
                          value="cancel-invite"
                          variant="ghost"
                          size="sm"
                        >
                          Cancel
                        </Button>
                      </Form>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {actionData && 'invited' in actionData && (
            <Alert className="mt-4">
              <AlertTitle>Invitation created for {actionData.invited}</AlertTitle>
              <AlertDescription>
                <span>
                  Send them this link. They sign in, or create an account, with that email to join.
                </span>
                <CopyLink link={actionData.link} />
              </AlertDescription>
            </Alert>
          )}
          {loaderData.canManage && (
            <Form method="post" className="mt-4 flex flex-wrap gap-2">
              <Input
                name="email"
                type="email"
                placeholder="colleague@example.com"
                className="max-w-xs"
                required
              />
              <NativeSelect name="role" defaultValue="member">
                <NativeSelectOption value="member">Member</NativeSelectOption>
                <NativeSelectOption value="admin">Admin</NativeSelectOption>
              </NativeSelect>
              <Button type="submit" name="intent" value="invite" variant="outline" disabled={busy}>
                Invite
              </Button>
            </Form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? 'Copied' : 'Copy invite link'}
    </Button>
  );
}

type Billing = Route.ComponentProps['loaderData']['billing'];
type PaidPlan = Route.ComponentProps['loaderData']['paidPlans'][number];

function BillingNotice({ billing }: { billing: Billing }) {
  const [params] = useSearchParams();
  const result = params.get('billing');
  if (result === 'success') {
    return (
      <Alert>
        <AlertTitle>Thanks — your subscription is being set up</AlertTitle>
        <AlertDescription>
          Your new plan applies as soon as Stripe confirms the payment, usually within a few
          seconds. Refresh if it hasn't changed yet.
        </AlertDescription>
      </Alert>
    );
  }
  if (billing.status === 'past_due' || billing.status === 'unpaid') {
    return (
      <Alert variant="destructive">
        <AlertTitle>Payment failed</AlertTitle>
        <AlertDescription>
          Update your payment method in billing settings to keep your plan.
        </AlertDescription>
      </Alert>
    );
  }
  if (billing.cancelAtPeriodEnd && billing.periodEnd) {
    return (
      <Alert>
        <AlertDescription>
          <span>
            Your subscription ends on <DateTime value={billing.periodEnd} />, then this team moves
            to the Free plan.
          </span>
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}

function PlanPicker({
  current,
  plans,
  billing,
}: {
  current: string;
  plans: PaidPlan[];
  billing: Billing;
}) {
  const fetcher = useFetcher<{ error?: string }>();
  const busy = fetcher.state !== 'idle';
  const subscribed = current !== 'free' && billing.hasCustomer;
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {plans.map((p) => {
          const isCurrent = p.id === current;
          return (
            <div
              key={p.id}
              className={`rounded-lg border p-4 ${isCurrent ? 'border-primary' : ''}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-medium">{p.name}</p>
                {p.price && <p className="tabular text-sm text-muted-foreground">{p.price}</p>}
              </div>
              <ul className="mt-2 grid gap-0.5 text-sm text-muted-foreground">
                <li>{p.maxUrlsPerCrawl.toLocaleString()} URLs per crawl</li>
                <li>{p.monthlyUrls.toLocaleString()} URLs a month</li>
                <li>{p.maxProjects} projects</li>
                {p.rendering && <li>JavaScript rendering</li>}
                {p.ai && <li>AI similarity and suggestions</li>}
                {p.schedules && <li>Scheduled crawls</li>}
                {p.api && <li>REST API</li>}
              </ul>
              {isCurrent ? (
                <p className="mt-3 text-sm font-medium text-primary">Current plan</p>
              ) : subscribed ? null : (
                <fetcher.Form method="post" action="/app/billing" className="mt-3">
                  <input type="hidden" name="plan" value={p.id} />
                  <Button type="submit" size="sm" disabled={busy}>
                    Upgrade to {p.name}
                  </Button>
                </fetcher.Form>
              )}
            </div>
          );
        })}
      </div>
      {billing.hasCustomer && (
        <fetcher.Form method="post" action="/app/billing">
          <Button
            type="submit"
            name="intent"
            value="portal"
            variant="outline"
            size="sm"
            disabled={busy}
          >
            {subscribed ? 'Change plan, payment method or invoices' : 'Billing history'}
          </Button>
        </fetcher.Form>
      )}
      {fetcher.data?.error && <p className="text-sm text-destructive">{fetcher.data.error}</p>}
    </div>
  );
}

function NotificationPrefs({ crawlFinished }: { crawlFinished: boolean }) {
  const fetcher = useFetcher();
  return (
    <div className="flex items-start gap-3">
      <Switch
        id="crawlFinished"
        defaultChecked={crawlFinished}
        onCheckedChange={(on) =>
          fetcher.submit(
            { intent: 'notifications', crawlFinished: on ? 'on' : '' },
            { method: 'post' },
          )
        }
      />
      <div className="grid gap-0.5">
        <Label htmlFor="crawlFinished">Crawl finished</Label>
        <p className="text-sm text-muted-foreground">
          A summary when a crawl you started completes. Owners and admins also get one for scheduled
          and API crawls.
        </p>
      </div>
    </div>
  );
}
