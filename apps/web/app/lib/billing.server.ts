/**
 * Stripe subscription billing. Each organization maps to one Stripe Customer; each paid plan is
 * its own Stripe Product with a monthly Price (ids in STRIPE_PRICE_PRO / STRIPE_PRICE_AGENCY).
 *
 * Upgrades go through Checkout (subscription mode); changes and cancellation through the
 * Customer Portal. Webhooks never trust an event's payload for the plan: they resolve the event
 * to its Customer, re-read that customer's subscriptions from Stripe, and derive the plan from
 * the current state. That makes duplicate, retried and out-of-order events harmless.
 */

import { env } from 'cloudflare:workers';
import { orgPlans, type PlanId } from '@raisin/db';
import { eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { db } from './env.server';

/** Tags Checkout Sessions from this flow in the Stripe Dashboard. */
const INTEGRATION_IDENTIFIER = 'raisin_plan_upgrade_qmvtrkzh';

/** Statuses that keep paid access. past_due keeps it while Stripe retries the payment. */
const ENTITLED = new Set<Stripe.Subscription.Status>(['active', 'trialing', 'past_due']);
const PLAN_RANK: Record<PlanId, number> = { free: 0, pro: 1, agency: 2 };

export function billingEnabled(): boolean {
  return Boolean(env.STRIPE_API_KEY && env.STRIPE_PRICE_PRO && env.STRIPE_PRICE_AGENCY);
}

function stripe(): Stripe {
  if (!env.STRIPE_API_KEY) throw new Error('Billing is not configured');
  return new Stripe(env.STRIPE_API_KEY);
}

function priceFor(plan: Exclude<PlanId, 'free'>): string {
  const price = plan === 'pro' ? env.STRIPE_PRICE_PRO : env.STRIPE_PRICE_AGENCY;
  if (!price) throw new Error(`No Stripe price configured for ${plan}`);
  return price;
}

function planForPrice(priceId: string): PlanId | null {
  if (priceId === env.STRIPE_PRICE_PRO) return 'pro';
  if (priceId === env.STRIPE_PRICE_AGENCY) return 'agency';
  return null;
}

/** The org's Stripe Customer, created on first use and remembered in org_plans. */
async function customerFor(org: { id: string; name: string }, email: string): Promise<string> {
  const database = db();
  const row = await database
    .select({ customer: orgPlans.billingCustomerId })
    .from(orgPlans)
    .where(eq(orgPlans.organizationId, org.id))
    .limit(1);
  if (row[0]?.customer) return row[0].customer;
  const customer = await stripe().customers.create(
    { name: org.name, email, metadata: { organization_id: org.id } },
    // One customer per org even if two admins click Upgrade at the same moment.
    { idempotencyKey: `raisin-customer-${org.id}` },
  );
  await database
    .insert(orgPlans)
    .values({ organizationId: org.id, planId: 'free', billingCustomerId: customer.id })
    .onConflictDoUpdate({
      target: orgPlans.organizationId,
      set: { billingCustomerId: customer.id },
    });
  return customer.id;
}

export async function createCheckout(input: {
  org: { id: string; name: string };
  email: string;
  plan: Exclude<PlanId, 'free'>;
}): Promise<string> {
  const customer = await customerFor(input.org, input.email);
  const session = await stripe().checkout.sessions.create({
    mode: 'subscription',
    customer,
    client_reference_id: input.org.id,
    line_items: [{ price: priceFor(input.plan), quantity: 1 }],
    // No payment_method_types: Stripe offers the methods enabled in the Dashboard.
    allow_promotion_codes: true,
    integration_identifier: INTEGRATION_IDENTIFIER,
    success_url: `${env.APP_URL}/app/settings?billing=success`,
    cancel_url: `${env.APP_URL}/app/settings?billing=cancelled`,
  });
  if (!session.url) throw new Error('Stripe did not return a Checkout URL');
  return session.url;
}

export async function createPortal(orgId: string): Promise<string> {
  const row = await db()
    .select({ customer: orgPlans.billingCustomerId })
    .from(orgPlans)
    .where(eq(orgPlans.organizationId, orgId))
    .limit(1);
  const customer = row[0]?.customer;
  if (!customer) throw new Error('This organization has no billing account yet');
  const session = await stripe().billingPortal.sessions.create({
    customer,
    return_url: `${env.APP_URL}/app/settings`,
  });
  return session.url;
}

/** Events that can change what a customer is entitled to. */
const HANDLED = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'invoice.paid',
  'invoice.payment_failed',
]);

/** Verify and apply a webhook. Returns the HTTP response to send back to Stripe. */
export async function handleStripeWebhook(request: Request): Promise<Response> {
  if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_API_KEY) {
    return new Response('Billing is not configured', { status: 503 });
  }
  const signature = request.headers.get('stripe-signature');
  if (!signature) return new Response('Missing signature', { status: 400 });
  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(
      body,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    return new Response('Invalid signature', { status: 400 });
  }
  if (!HANDLED.has(event.type)) return Response.json({ received: true, ignored: event.type });

  const customer = customerOf(event);
  if (!customer) return Response.json({ received: true, ignored: 'no customer' });
  const plan = await syncCustomer(customer);
  return Response.json({ received: true, plan });
}

function customerOf(event: Stripe.Event): string | null {
  const object = event.data.object as { customer?: string | { id: string } | null };
  const c = object.customer;
  if (!c) return null;
  return typeof c === 'string' ? c : c.id;
}

/**
 * Re-derive an organization's plan from the customer's current subscriptions in Stripe.
 * Exported so an admin action or the cron can repair drift too.
 */
export async function syncCustomer(customerId: string): Promise<PlanId | null> {
  const database = db();
  const owner = await database
    .select({ orgId: orgPlans.organizationId })
    .from(orgPlans)
    .where(eq(orgPlans.billingCustomerId, customerId))
    .limit(1);
  let orgId = owner[0]?.orgId;
  if (!orgId) {
    // Fallback only: a customer created outside our flow but tagged with the org.
    const customer = await stripe().customers.retrieve(customerId);
    if (customer.deleted) return null;
    orgId = customer.metadata.organization_id;
    if (!orgId) return null;
  }

  const subs = await stripe().subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 20,
  });
  let best: { plan: PlanId; sub: Stripe.Subscription } | null = null;
  for (const sub of subs.data) {
    if (!ENTITLED.has(sub.status)) continue;
    for (const item of sub.items.data) {
      const plan = planForPrice(item.price.id);
      if (plan && (!best || PLAN_RANK[plan] > PLAN_RANK[best.plan])) best = { plan, sub };
    }
  }
  const latest = best?.sub ?? subs.data[0] ?? null;
  const periodEnd = latest?.items.data[0]?.current_period_end;
  const plan: PlanId = best?.plan ?? 'free';

  await database
    .insert(orgPlans)
    .values({
      organizationId: orgId,
      planId: plan,
      billingCustomerId: customerId,
      billingSubscriptionId: latest?.id ?? null,
      billingStatus: latest?.status ?? null,
      billingPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      billingCancelAtPeriodEnd: latest?.cancel_at_period_end ?? false,
    })
    .onConflictDoUpdate({
      target: orgPlans.organizationId,
      set: {
        planId: plan,
        billingCustomerId: customerId,
        billingSubscriptionId: latest?.id ?? null,
        billingStatus: latest?.status ?? null,
        billingPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
        billingCancelAtPeriodEnd: latest?.cancel_at_period_end ?? false,
        updatedAt: new Date(),
      },
    });
  return plan;
}

export async function billingState(orgId: string) {
  const row = await db()
    .select({
      customer: orgPlans.billingCustomerId,
      status: orgPlans.billingStatus,
      periodEnd: orgPlans.billingPeriodEnd,
      cancelAtPeriodEnd: orgPlans.billingCancelAtPeriodEnd,
    })
    .from(orgPlans)
    .where(eq(orgPlans.organizationId, orgId))
    .limit(1);
  return {
    enabled: billingEnabled(),
    hasCustomer: Boolean(row[0]?.customer),
    status: row[0]?.status ?? null,
    periodEnd: row[0]?.periodEnd ?? null,
    cancelAtPeriodEnd: row[0]?.cancelAtPeriodEnd ?? false,
  };
}

let priceCache: { at: number; prices: Partial<Record<PlanId, string>> } | null = null;

/** Display prices for the paid plans, read from Stripe and cached for an hour. */
export async function planPrices(): Promise<Partial<Record<PlanId, string>>> {
  if (!billingEnabled()) return {};
  if (priceCache && Date.now() - priceCache.at < 3_600_000) return priceCache.prices;
  const out: Partial<Record<PlanId, string>> = {};
  await Promise.all(
    (['pro', 'agency'] as const).map(async (plan) => {
      try {
        const price = await stripe().prices.retrieve(priceFor(plan));
        if (price.unit_amount === null) return;
        const amount = new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: price.currency.toUpperCase(),
          maximumFractionDigits: price.unit_amount % 100 === 0 ? 0 : 2,
        }).format(price.unit_amount / 100);
        out[plan] = price.recurring ? `${amount}/${price.recurring.interval}` : amount;
      } catch (e) {
        console.error('price lookup failed', plan, e);
      }
    }),
  );
  priceCache = { at: Date.now(), prices: out };
  return out;
}
